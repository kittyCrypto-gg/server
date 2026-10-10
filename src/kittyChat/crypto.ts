import crypto from "crypto";
import type { ChatMessage } from "./types";

const CHAT_KEY_RAW = process.env.CHAT_KEY || "";
const CHAT_KEY_BUFFER = Buffer.from(CHAT_KEY_RAW, "base64");
const CHAT_KEY = CHAT_KEY_BUFFER.subarray(0, 32);

export function generateMsgId(id: string, timestamp: string, sessionToken: string): string {
    const unixTimestamp = Math.floor(new Date(timestamp).getTime() / 1000);
    const salt = crypto.randomBytes(8).toString("hex");
    const hash = crypto
        .createHash("sha256")
        .update(`${id}${unixTimestamp}${sessionToken}${salt}`)
        .digest("hex");
    const numericHash = BigInt(`0x${hash.substring(0, 16)}`);
    const session = BigInt(`0x${sessionToken}`);
    return (numericHash * session).toString();
}

export function generateUserId(ip: string): string {
    const hash = crypto.createHash("sha256").update(ip).digest("hex").substring(0, 10);
    return `0x${hash}`;
}

export function encryptValue(value: string, key: Buffer = CHAT_KEY): string {
    if (!key) {
        throw new Error("key is missing. Ensure it is properly set.");
    }
     if (key.length !== 32) {
        throw new Error(`key must be exactly 32 bytes, but got ${key.length} bytes.`);
    }
     const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
     const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
     return `v2:${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

export function decryptValue(encryptedValue: string, key: Buffer = CHAT_KEY): string {
    try {
        if (!key) {
            throw new Error("key is missing. Ensure it is properly set.");
        }
         if (key.length !== 32) {
            throw new Error(`key must be exactly 32 bytes, but got ${key.length} bytes.`);
        }
         const parts = encryptedValue.split(":");
         if (parts.length === 4 && parts[0] === "v2") {
            const iv = Buffer.from(parts[1], "hex");
            const tag = Buffer.from(parts[2], "hex");
            const encryptedText = Buffer.from(parts[3], "hex");
             const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
            decipher.setAuthTag(tag);
             const decrypted = Buffer.concat([decipher.update(encryptedText), decipher.final()]);
            return decrypted.toString("utf8");
        }
         if (parts.length === 2) {
            const iv = Buffer.from(parts[0], "hex");
            const encryptedText = Buffer.from(parts[1], "hex");
             const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
            const decrypted = Buffer.concat([decipher.update(encryptedText), decipher.final()]);
            return decrypted.toString("utf8");
        }
         throw new Error("Unknown encrypted format");
    } catch (error) {
        console.error("❌ ERROR: Decryption failed!", error);
        return "ERROR";
    }
}

export function encryptChatMessage(message: ChatMessage): ChatMessage {
    return {
        nick: encryptValue(message.nick),
        id: encryptValue(message.id),
        msg: encryptValue(message.msg),
        msgId: message.msgId,
        timestamp: message.timestamp,
        ...(message.edited ? { edited: true } : {}),
    };
}

export function decryptChatMessage(message: ChatMessage): ChatMessage {
    return {
        nick: decryptValue(message.nick),
        id: decryptValue(message.id),
        msg: decryptValue(message.msg),
        msgId: message.msgId,
        timestamp: message.timestamp,
        ...(message.edited ? { edited: true } : {}),
    };
}
