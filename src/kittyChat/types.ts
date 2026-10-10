export interface ChatRequest {
    nick: string;
    msg: string;
    ip: string;
    sessionToken: string;
}

export interface ChatMessage {
    nick: string;
    id: string;
    msg: string;
    timestamp: string;
    msgId: string;
    edited?: boolean;
}

export interface ModeratorStrings {
    role?: string;
    user?: string;
}
