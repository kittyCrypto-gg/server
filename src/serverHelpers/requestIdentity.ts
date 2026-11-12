import type { Request } from "express";
import type Server from "../baseServer";
import crypto from "crypto";

export function generateSessionToken(): string {
    return crypto.randomBytes(64).toString("hex");
}

export function getClientIp(req: Request): string {
    const cf = req.headers["cf-connecting-ip"];
    if (typeof cf === "string" && cf.trim()) return cf.trim();

    const xff = req.headers["x-forwarded-for"];
    const raw = Array.isArray(xff) ? xff[0] : xff;

    let ip = typeof raw === "string" && raw.trim()
        ? raw.split(",")[0]!.trim()
        : (req.socket.remoteAddress || "");

    if (ip.startsWith("::ffff:")) {
        ip = ip.substring(7);
    }

    return ip;
}

export function originAllowsDecrypted(origin: string | undefined, server: Server): boolean {
    if (!origin) return false;
    if (origin === "null") return false;
    return server.allowedOriginsList.includes(origin);
}
