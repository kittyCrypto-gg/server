import { expect, test } from "bun:test";
import { assertAllowedTarget, assertToken, readRenderJob, InputError } from "../src/render/request";
import { getAllowedOrigins, getTimeout, getRequestRenderConfig, getExecutablePath } from "../src/render/config";
import { handleRenderRequest, closeRenderBrowser } from "../src/render";

test("render requests keep GET selector and target parsing", async () => {
    const request = new Request("https://worker.example.invalid/render?url=https%3A%2F%2Fkittycrow.dev%2F&waitForSelector=%23app");
    expect(await readRenderJob(request)).toEqual({ url: "https://kittycrow.dev/", waitForSelector: "#app" });
});

test("render requests keep POST JSON parsing and reject invalid methods", async () => {
    const post = new Request("https://worker.example.invalid/render", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: "https://kittycrypto.gg/", waitForSelector: ".ready" })
    });
    expect(await readRenderJob(post)).toEqual({ url: "https://kittycrypto.gg/", waitForSelector: ".ready" });
    await expect(readRenderJob(new Request("https://worker.example.invalid/", { method: "PUT" })))
        .rejects.toThrow("Only GET and POST are supported.");
});

test("target origin allowlist and errors are unchanged", () => {
    expect(getAllowedOrigins({})).toEqual(new Set(["https://kittycrypto.gg", "https://kittycrow.dev"]));
    expect(() => assertAllowedTarget(new URL("https://kittycrow.dev/page"), {})).not.toThrow();
    expect(() => assertAllowedTarget(new URL("https://evil.invalid/"), {}))
        .toThrow("Target origin is not allowed: https://evil.invalid");
    expect(() => assertAllowedTarget(new URL("https://kittycrow.dev/"), {
        allowedOrigins: ["https://different.invalid/some/path"]
    })).toThrow(InputError);
});

test("render authentication and failure responses keep their status and content-type", async () => {
    expect(() => assertToken(new Request("https://worker.example.invalid/"), {})).not.toThrow();
    expect(() => assertToken(new Request("https://worker.example.invalid/"), { token: "required" }))
        .toThrow("Invalid render token.");
    const invalidToken = await handleRenderRequest(
        new Request("https://worker.example.invalid/render"), { token: "required" }
    );
    expect(invalidToken.status).toBe(400);
    expect(await invalidToken.text()).toBe("Render failed: Invalid render token.");
    expect(invalidToken.headers.get("content-type")).toBe("text/plain; charset=UTF-8");
    const missingUrl = await handleRenderRequest(new Request("https://worker.example.invalid/render"));
    expect(missingUrl.status).toBe(400);
    expect(await missingUrl.text()).toBe("Render failed: Missing url.");
});

test("browser configuration retains the default timeout, executable path and origins", () => {
    expect(getTimeout({})).toBe(30_000);
    expect(getTimeout({ timeoutMs: 500 })).toBe(500);
    expect(getExecutablePath({ executablePath: "/usr/bin/chromium" })).toBe("/usr/bin/chromium");
    expect(getRequestRenderConfig({ allowedOrigins: ["https://custom.invalid"], executablePath: "/browser" }))
        .toMatchObject({ allowedOrigins: ["https://custom.invalid"], executablePath: "/browser" });
});

test("closing an uninitialised browser is harmless", async () => {
    await expect(closeRenderBrowser()).resolves.toBeUndefined();
});
