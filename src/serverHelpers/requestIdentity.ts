import type Server from "../baseServer";
import crypto from "crypto";

export function generateSessionToken(): string {
    return crypto.randomBytes(64).toString("hex");
}

export { getClientIp } from "../requestIp";

export function originAllowsDecrypted(origin: string | undefined, server: Server): boolean {
    if (!origin) return false;
    if (origin === "null") return false;
    return server.allowedOriginsList.includes(origin);
}
