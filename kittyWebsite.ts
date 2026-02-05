import { Request, Response, NextFunction } from "express";
import puppeteer from "puppeteer-core";
import type Server from "./baseServer";
import fetch from "node-fetch";
import { init, parse } from "es-module-lexer";

type RewriteContext = {
  renderOrigin: string;
  kittyOrigin: string;
  pageUrl: string;
};

type ScriptItem = {
  placement: "head" | "body";
  attrsSansSrc: string;
  srcAbs: string | null;
  inlineCode: string | null;
  isModule: boolean;
  isKittyScript: boolean;
};

class KittyWebsite {
  private ready: boolean = false;
  private static lexerReady: Promise<void> | null = null;

  constructor(server: Server) {
    try {
      server.app.use("/website", (req: Request, res: Response, next: NextFunction) => {
        if (req.method !== "GET") {
          next();
          return;
        }

        void this.handleRender(req, res);
      });

      this.ready = true;
    } catch (error) {
      console.error("❌ Failed to register /website endpoint:", error);
      this.ready = false;
    }
  }

  public readyMessage(): string {
    return this.ready
      ? "🌐 Renderer is ready."
      : "⚠️ Renderer is not ready. Something went wrong.";
  }

  private buildTargetUrl(req: Request): string {
    const original = typeof req.originalUrl === "string" ? req.originalUrl : req.url;
    const withoutPrefix = original.startsWith("/website")
      ? original.slice("/website".length)
      : original;

    const pathAndQuery = withoutPrefix.length === 0 ? "/" : withoutPrefix;
    const normalised = pathAndQuery.startsWith("/") ? pathAndQuery : `/${pathAndQuery}`;

    return `https://kittycrypto.gg${normalised}`;
  }

  private static ensureLexer(): Promise<void> {
    if (KittyWebsite.lexerReady) return KittyWebsite.lexerReady;
    KittyWebsite.lexerReady = init;
    return KittyWebsite.lexerReady;
  }

  private static ensureBaseTag(html: string, renderOrigin: string): string {
    const baseTag = `<base href="${renderOrigin}/">`;

    if (/<base\s+/i.test(html)) {
      return html.replace(/<base\b[^>]*>/i, baseTag);
    }

    return html.replace(/<head[^>]*>/i, match => `${match}\n${baseTag}`);
  }

  private static isSkippableUrl(raw: string): boolean {
    const v = raw.trim().toLowerCase();
    if (!v) return true;
    if (v.startsWith("#")) return true;
    if (v.startsWith("mailto:")) return true;
    if (v.startsWith("tel:")) return true;
    if (v.startsWith("javascript:")) return true;
    if (v.startsWith("data:")) return true;
    if (v.startsWith("blob:")) return true;
    return false;
  }

  private static rewriteNavUrl(raw: string, ctx: RewriteContext): string {
    if (KittyWebsite.isSkippableUrl(raw)) return raw;

    let resolved: URL;
    try {
      resolved = new URL(raw, ctx.pageUrl);
    } catch {
      return raw;
    }

    if (resolved.origin !== ctx.kittyOrigin) return raw;
    return `${resolved.pathname}${resolved.search}${resolved.hash}`;
  }

  private static rewriteAssetUrl(raw: string, ctx: RewriteContext): string {
    if (KittyWebsite.isSkippableUrl(raw)) return raw;

    let resolved: URL;
    try {
      resolved = new URL(raw, ctx.pageUrl);
    } catch {
      return raw;
    }

    if (resolved.origin === ctx.kittyOrigin) return resolved.href;
    return raw;
  }

  private static rewriteSrcset(raw: string, ctx: RewriteContext): string {
    const parts = raw
      .split(",")
      .map(p => p.trim())
      .filter(Boolean);

    const rewritten = parts.map(part => {
      const tokens = part.split(/\s+/).filter(Boolean);
      const first = tokens[0] ?? "";
      const rest = tokens.slice(1).join(" ");
      const url = KittyWebsite.rewriteAssetUrl(first, ctx);
      return rest ? `${url} ${rest}` : url;
    });

    return rewritten.join(", ");
  }

  private static rewriteHtml(html: string, ctx: RewriteContext): string {
    let out = KittyWebsite.ensureBaseTag(html, ctx.renderOrigin);

    out = out.replace(
      /(<a\b[^>]*?\bhref=)(["'])([^"']*)(\2)/gi,
      (_m, prefix: string, q: string, href: string, suffix: string) => {
        const nextHref = KittyWebsite.rewriteNavUrl(href, ctx);
        return `${prefix}${q}${nextHref}${suffix}`;
      }
    );

    out = out.replace(
      /(<form\b[^>]*?\baction=)(["'])([^"']*)(\2)/gi,
      (_m, prefix: string, q: string, action: string, suffix: string) => {
        const nextAction = KittyWebsite.rewriteNavUrl(action, ctx);
        return `${prefix}${q}${nextAction}${suffix}`;
      }
    );

    const assetAttrRegexes: RegExp[] = [
      /(<link\b[^>]*?\bhref=)(["'])([^"']*)(\2)/gi,
      /(<img\b[^>]*?\bsrc=)(["'])([^"']*)(\2)/gi,
      /(<source\b[^>]*?\bsrc=)(["'])([^"']*)(\2)/gi,
      /(<video\b[^>]*?\bsrc=)(["'])([^"']*)(\2)/gi,
      /(<audio\b[^>]*?\bsrc=)(["'])([^"']*)(\2)/gi,
      /(<iframe\b[^>]*?\bsrc=)(["'])([^"']*)(\2)/gi
    ];

    for (const re of assetAttrRegexes) {
      out = out.replace(
        re,
        (_m, prefix: string, q: string, value: string, suffix: string) => {
          const nextValue = KittyWebsite.rewriteAssetUrl(value, ctx);
          return `${prefix}${q}${nextValue}${suffix}`;
        }
      );
    }

    out = out.replace(
      /(\bsrcset=)(["'])([^"']*)(\2)/gi,
      (_m, prefix: string, q: string, value: string, suffix: string) => {
        const nextValue = KittyWebsite.rewriteSrcset(value, ctx);
        return `${prefix}${q}${nextValue}${suffix}`;
      }
    );

    out = out.replace(
      /(url\(\s*['"]?)(\/(?!\/))/gi,
      `$1${ctx.kittyOrigin}/`
    );

    out = out.replace(/<script\b[\s\S]*?<\/script\s*>/gi, "");

    return out;
  }

  private static extractSection(html: string, tag: "head" | "body"): string {
    const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
    const match = html.match(re);
    return match ? match[1] : "";
  }

  private static parseScriptsFromSection(sectionHtml: string, placement: "head" | "body", ctx: RewriteContext): ScriptItem[] {
    const items: ScriptItem[] = [];
    const re = /<script\b([\s\S]*?)>([\s\S]*?)<\/script\s*>/gi;
    let m: RegExpExecArray | null;

    while ((m = re.exec(sectionHtml)) !== null) {
      const rawAttrs = m[1] ?? "";
      const inlineCode = (m[2] ?? "").trim();
      const srcMatch = rawAttrs.match(/\bsrc=(["'])([^"']+)\1/i);
      const typeMatch = rawAttrs.match(/\btype=(["'])([^"']+)\1/i);

      const isModule = (typeMatch?.[2] ?? "").trim().toLowerCase() === "module";

      const srcRaw = srcMatch?.[2] ?? null;

      const srcAbs = (() => {
        if (!srcRaw) return null;
        try {
          return new URL(srcRaw, ctx.pageUrl).href;
        } catch {
          return null;
        }
      })();

      const isKittyScript = (() => {
        if (!srcAbs) return false;
        try {
          return new URL(srcAbs).origin === ctx.kittyOrigin;
        } catch {
          return false;
        }
      })();

      const attrsSansSrc = rawAttrs
        .replace(/\bsrc=(["'])([^"']+)\1/i, "")
        .replace(/\s{2,}/g, " ")
        .trim();

      items.push({
        placement,
        attrsSansSrc: attrsSansSrc ? ` ${attrsSansSrc}` : "",
        srcAbs,
        inlineCode: srcAbs ? null : inlineCode,
        isModule,
        isKittyScript
      });
    }

    return items;
  }

  private static externalise(upstreamAbs: string, ctx: RewriteContext): string {
    return `${ctx.kittyOrigin}/external?src=${encodeURIComponent(upstreamAbs)}`;
  }

  private static escapeInlineScript(code: string): string {
    return code.replace(/<\/script/gi, "<\\/script");
  }

  private static rewriteImportMetaUrl(code: string, moduleUrlAbs: string): { patched: string; prologue: string } {
    const needsPatch = /\bimport\.meta\.url\b/.test(code);
    if (!needsPatch) {
      return { patched: code, prologue: "" };
    }

    const varName = "__KC_MODULE_URL__";
    const prologue = `const ${varName} = ${JSON.stringify(moduleUrlAbs)};\n`;
    const patched = code.replace(/\bimport\.meta\.url\b/g, varName);
    return { patched, prologue };
  }

  private static async rewriteModuleImports(code: string, moduleUrlAbs: string, ctx: RewriteContext): Promise<string> {
    await KittyWebsite.ensureLexer();

    const parsed = parse(code);
    const imports = parsed[0];

    if (imports.length === 0) return code;

    let out = "";
    let last = 0;

    for (const entry of imports) {
      const spec = entry.n;
      if (!spec) continue;

      const start = entry.s;
      const end = entry.e;

      out += code.slice(last, start);

      const next = (() => {
        if (KittyWebsite.isSkippableUrl(spec)) return spec;

        let resolved: URL;
        try {
          resolved = new URL(spec, moduleUrlAbs);
        } catch {
          return spec;
        }

        const isKitty = resolved.origin === ctx.kittyOrigin;
        if (!isKitty) return spec;

        return KittyWebsite.externalise(resolved.href, ctx);
      })();

      out += next;
      last = end;
    }

    out += code.slice(last);
    return out;
  }

  private static async inlineScript(item: ScriptItem, ctx: RewriteContext): Promise<string> {
    if (item.srcAbs === null) {
      const code = item.inlineCode ?? "";
      const safe = KittyWebsite.escapeInlineScript(code);
      return `<script${item.attrsSansSrc}>${safe}</script>`;
    }

    const isKitty = item.isKittyScript;
    if (!isKitty) {
      const srcAbs = item.srcAbs;
      return `<script src="${srcAbs}"${item.attrsSansSrc}></script>`;
    }

    const moduleUrlAbs = item.srcAbs;
    const viaWorker = KittyWebsite.externalise(moduleUrlAbs, ctx);

    const res = await fetch(viaWorker, {
      headers: { Accept: "application/javascript,*/*;q=0.1" }
    });

    if (!res.ok) {
      return `<script src="${moduleUrlAbs}"${item.attrsSansSrc}></script>`;
    }

    let code = await res.text();

    if (item.isModule) {
      const metaPatched = KittyWebsite.rewriteImportMetaUrl(code, moduleUrlAbs);
      const importRewritten = await KittyWebsite.rewriteModuleImports(metaPatched.patched, moduleUrlAbs, ctx);
      code = metaPatched.prologue + importRewritten;
    }

    const safe = KittyWebsite.escapeInlineScript(code);
    return `<script${item.attrsSansSrc}>${safe}</script>`;
  }

  private static async buildInlinedScripts(originalHtml: string, ctx: RewriteContext): Promise<{ head: string; body: string }> {
    const head = KittyWebsite.extractSection(originalHtml, "head");
    const body = KittyWebsite.extractSection(originalHtml, "body");

    const headItems = KittyWebsite.parseScriptsFromSection(head, "head", ctx);
    const bodyItems = KittyWebsite.parseScriptsFromSection(body, "body", ctx);

    const headTags: string[] = [];
    for (const item of headItems) {
      headTags.push(await KittyWebsite.inlineScript(item, ctx));
    }

    const bodyTags: string[] = [];
    for (const item of bodyItems) {
      bodyTags.push(await KittyWebsite.inlineScript(item, ctx));
    }

    return {
      head: headTags.join("\n"),
      body: bodyTags.join("\n")
    };
  }

  private static injectScripts(html: string, headBlock: string, bodyBlock: string): string {
    let out = html;

    if (headBlock) {
      const baseRe = /<base\b[^>]*>\s*/i;
      if (baseRe.test(out)) {
        out = out.replace(baseRe, match => `${match}\n${headBlock}\n`);
      } else {
        out = out.replace(/<head\b[^>]*>/i, match => `${match}\n${headBlock}\n`);
      }
    }

    if (bodyBlock) {
      out = out.replace(/<\/body>/i, match => `\n${bodyBlock}\n${match}`);
    }

    return out;
  }

  public async handleRender(req: Request, res: Response): Promise<void> {
    const targetUrl = this.buildTargetUrl(req);

    try {
      const host = typeof req.headers.host === "string" ? req.headers.host : "render.kittycrypto.gg";
      const proto = req.protocol || "https";
      const renderOrigin = `${proto}://${host}`;

      const ctx: RewriteContext = {
        renderOrigin,
        kittyOrigin: "https://kittycrypto.gg",
        pageUrl: targetUrl
      };

      const browser = await puppeteer.launch({
        executablePath: "/usr/bin/chromium-browser",
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox"]
      });

      const page = await browser.newPage();

      const docRes = await page.goto(targetUrl, { waitUntil: "networkidle0" });
      const originalHtml = docRes ? await docRes.text() : "";

      try {
        await page.waitForFunction(
          () => {
            const el = document.getElementById("reader");
            return !!el && el.innerHTML.trim().length > 0;
          },
          { timeout: 5000 }
        );
      } catch {
        console.log("⚠️ Timeout waiting for #reader to load content.");
      }

      const renderedSnapshot = await page.content();
      await browser.close();

      const rewritten = KittyWebsite.rewriteHtml(renderedSnapshot, ctx);

      const scripts = await KittyWebsite.buildInlinedScripts(originalHtml, ctx);
      const finalHtml = KittyWebsite.injectScripts(rewritten, scripts.head, scripts.body);

      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.send(finalHtml);
    } catch (err) {
      console.log(`❌ Error rendering page at ${targetUrl}:`, err);
      res.status(500).send("Error rendering page");
    }
  }
}

export default KittyWebsite;