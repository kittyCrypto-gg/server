import type { InternalPresenceSnapshot, PublicPresenceSnapshot, SshdProcessInfo } from "./presence/types";
import { getInternalPresence as fetchInternalPresence } from "./presence/client";
import { formatPublicPresence } from "./presence/format";
import { psGrepSSHD as scanSshd } from "./presence/ssh";

export async function getInternalPresence(): Promise<InternalPresenceSnapshot[]> {
    return await fetchInternalPresence();
}

export async function getPublicPresence(): Promise<PublicPresenceSnapshot> {
    const internalPresence = await getInternalPresence();
    return formatPublicPresence(internalPresence);
}

export function psGrepSSHD(): SshdProcessInfo[] {
    return scanSshd();
}
