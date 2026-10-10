import { expect, test } from "bun:test";
import type { Request } from "express";
import { getClientIp as canonicalIp } from "../src/requestIp";
import { getClientIp as rateLimitIp } from "../src/rateLimiter/logic";
import { getClientIp as requestIp } from "../src/serverHelpers/requestIdentity";

const req = (headers:Record<string,string|string[]|undefined>, remoteAddress=""):Request =>
    ({headers,socket:{remoteAddress}} as unknown as Request);

test("both old consumer import paths retain the exact same function",()=>{
    expect(rateLimitIp).toBe(canonicalIp);
    expect(requestIp).toBe(canonicalIp);
});

test("Cloudflare connecting IP takes precedence over forwarding and socket addresses",()=>{
    for(const method of [canonicalIp,rateLimitIp,requestIp]) {
        expect(method(req({
            "cf-connecting-ip":" 203.0.113.12 ",
            "x-forwarded-for":"198.51.100.2, 198.51.100.3"
        },"10.0.0.1"))).toBe("203.0.113.12");
    }
});

test("X-Forwarded-For retains original comma parsing, array first-entry and trim semantics",()=>{
    expect(requestIp(req({"x-forwarded-for":" 198.51.100.21 , 198.51.100.22"}))).toBe("198.51.100.21");
    expect(rateLimitIp(req({"x-forwarded-for":["198.51.100.9, 198.51.100.10", "198.51.100.11"]}))).toBe("198.51.100.9");
    expect(canonicalIp(req({"x-forwarded-for":["","198.51.100.11"]},"192.0.2.30"))).toBe("192.0.2.30");
});

test("socket fallback strips IPv4-mapped IPv6 but preserves native IPv6",()=>{
    expect(canonicalIp(req({},"::ffff:192.0.2.15"))).toBe("192.0.2.15");
    expect(rateLimitIp(req({},"2001:db8::1"))).toBe("2001:db8::1");
    expect(requestIp(req({},undefined))).toBe("");
});

test("Cloudflare array is still ignored, exactly as before",()=>{
    expect(canonicalIp(req({
        "cf-connecting-ip":["203.0.113.1"],
        "x-forwarded-for":"192.0.2.1"
    }))).toBe("192.0.2.1");
});
