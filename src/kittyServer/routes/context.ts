import type Server from "../../baseServer";
import type Chat from "../../kittyChat";
import type { tokenStore } from "../../tokenStore";
import type { SseClient } from "../../types";
import type { ImageTransformer } from "../../imageTransformer";
import type { TrSites } from "../../trustedSites";
import type { VisitsStore } from "../../visits";
import type { ExtVisitsStore } from "../../extVisits";
import type rateLimiter from "../../rateLimiter";

/** Shared references and configuration created by the executable entry point. */
export interface KittyRouteContext {
    server: Server;
    TokenStore: tokenStore;
    chat: Chat;
    clients: SseClient[];
    comments_json_path: string;
    storiesRoot: string;
    sitesToMap: Set<string>;
    allowedSourcesPath: string;
    CHATBOT_API_KEY: string;
    chatbot_PATH: string;
    imageTransformer: ImageTransformer;
    RENDER_TOKEN: string;
    RateLimiter: rateLimiter;
    trustedSites: TrSites;
    BASE_URL: string;
    visits: VisitsStore;
    externalVisits: ExtVisitsStore;
}
