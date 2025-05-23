import crypto from "crypto";
import fs from "fs";
import path from "path";

// Generate a 32-byte key
const generateKey = (): Buffer => {
    return crypto.randomBytes(32);
};

// Encryption method (same as `encryptValue` in kittyChat.ts)
const encryptValue = (value: string, key: Buffer): string => {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
    const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);

    return iv.toString("hex") + ":" + encrypted.toString("hex");
};

// Read chat.json, encrypt the values, and save the output
const encryptChat = (chatFilePath: string, outputFilePath: string, key: Buffer) => {
    try {
        const chatData = JSON.parse(fs.readFileSync(chatFilePath, "utf-8"));

        const encryptedData = chatData.map((msg: any) => ({
            nick: encryptValue(msg.nick, key),
            id: encryptValue(msg.id, key),
            msg: encryptValue(msg.msg, key),
            timestamp: msg.timestamp // ✅ Timestamp remains unchanged
        }));

        fs.writeFileSync(outputFilePath, JSON.stringify(encryptedData, null, 2), "utf-8");
        console.log(`✅ Chat successfully encrypted and saved to: ${outputFilePath}`);
    } catch (error) {
        console.error("❌ ERROR: Failed to encrypt chat.json", error);
    }
};

// Run encryption process
const chatFilePath = path.join(__dirname, "chat.json");
const outputFilePath = path.join(__dirname, "encrypted_chat.json");
const generatedKey = generateKey();

console.log("🔑 Generated Key (Save this for decryption!):", generatedKey.toString("base64"));

// Encrypt the chat
encryptChat(chatFilePath, outputFilePath, generatedKey);