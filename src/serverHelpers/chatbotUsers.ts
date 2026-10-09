import fs from "fs";

type ChatbotUser = {
    username: string;
    hash: string;
};

type ChatbotDoc = {
    version: number;
    updatedAt: string;
    users: ChatbotUser[];
};

function createInitialChatbotDoc(): ChatbotDoc {
    return {
        version: 0,
        updatedAt: new Date().toISOString(),
        users: []
    };
}

function normaliseChatbotDoc(value: unknown): ChatbotDoc {
    if (typeof value !== "object" || value === null) {
        return createInitialChatbotDoc();
    }

    const raw = value as Partial<ChatbotDoc>;
    const users = Array.isArray(raw.users)
        ? raw.users.filter((entry: unknown): entry is ChatbotUser => {
            return (
                typeof entry === "object" &&
                entry !== null &&
                typeof (entry as ChatbotUser).username === "string" &&
                typeof (entry as ChatbotUser).hash === "string"
            );
        })
        : [];

    return {
        version: typeof raw.version === "number" ? raw.version : 0,
        updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : new Date().toISOString(),
        users
    };
}

export async function updateUsersFile(
    mutate: (doc: ChatbotDoc) => void,
    retries = 5
): Promise<void> {
    const targetPath = process.env.CHATBOT_PATH || "";

    if (!targetPath) {
        throw new Error("CHATBOT_PATH is not configured");
    }

    for (let i = 0; i < retries; i++) {
        let doc: ChatbotDoc;

        try {
            const raw = await fs.promises.readFile(targetPath, "utf8");

            if (!raw.trim()) {
                throw new Error("Empty users file");
            }

            doc = normaliseChatbotDoc(JSON.parse(raw) as unknown);
        } catch {
            console.warn("Users file missing, empty, or invalid, initialising new store");
            doc = createInitialChatbotDoc();
        }

        const baseVersion = doc.version;

        mutate(doc);

        doc.version = baseVersion + 1;
        doc.updatedAt = new Date().toISOString();

        const tmp = `${targetPath}.${process.pid}.${Date.now()}.tmp`;

        await fs.promises.writeFile(
            tmp,
            JSON.stringify(doc, null, 2),
            "utf8"
        );

        try {
            await fs.promises.rename(tmp, targetPath);
            return;
        } catch {
            await fs.promises.unlink(tmp).catch(() => { });
        }
    }

    throw new Error("Failed to commit user file after multiple retries");
}
