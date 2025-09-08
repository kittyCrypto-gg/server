import { Request, Response } from "express";
import puppeteer from 'puppeteer-core';
import type Server from "./baseServer";

class KittyWebsite {
  private ready: boolean = false;

  constructor(server: Server) {
    try {
      server.app.get("/website/:path(*)", this.handleRender.bind(this));
      server.app.get("/website", this.handleRender.bind(this));
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

  async handleRender(req: Request, res: Response) {
    // Handle query string too
    const path = req.params.path ? `/${req.params.path}` : "";
    const search = req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : "";
    const targetUrl = `https://kittycrypto.gg${path}${search}`;

    try {
      const browser = await puppeteer.launch({
        executablePath: '/usr/bin/chromium-browser',
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      });
      const page = await browser.newPage();

      await page.goto(targetUrl, { waitUntil: "networkidle0" });

      // Wait for something specific that proves your content is fully loaded.
      // For your reader, let's wait for .reader-bookmark or #reader having innerHTML
      try {
        // Wait max 5 seconds for story content to load
        await page.waitForFunction(
          () => {
            const el = document.getElementById('reader');
            return el && el.innerHTML.trim().length > 0;
          },
          { timeout: 5000 }
        );
      } catch (err) {
        console.log("⚠️ Timeout waiting for #reader to load content.");
      }

      let html = await page.content();
      await browser.close();

      // Absolute URLs for all static assets
      html = html
        .replace(/(href|src)="\/(?!\/)/g, '$1="https://kittycrypto.gg/')
        .replace(/(url\(['"]?)\/(?!\/)/g, '$1https://kittycrypto.gg/');

      const host = req.headers.host; // Use the request's host header
      const protocol = req.protocol || 'https'; // Default to https if not specified

      html = html.replace(
        /\b(href|src)="\.\/([^"]+)"/g,
        (match, attr, relPath) => `${attr}="${protocol}://${host}/website/${relPath}"`
      );

      // Add <base> tag if not present
      if (!/<base\s+/i.test(html)) {
        html = html.replace(/<head[^>]*>/i,
          match => `${match}\n<base href="https://kittycrypto.gg/">`
        );
      }

      // REMOVE ALL <script> tags to avoid re-injection!
      html = html.replace(/<script[\s\S]*?<\/script>/gi, '');

      res.setHeader("Content-Type", "text/html");
      res.send(html);

    } catch (err) {
      res.status(500).send("Error rendering page");
      console.log(`❌ Error rendering page at ${targetUrl}:`, err);
    }
  }
}

export default KittyWebsite;