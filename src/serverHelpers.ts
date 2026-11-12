import "dotenv/config";

export { registerAppDiscoveryEndpoint } from "./serverHelpers/appDiscovery.ts";
export { parseImgQuery, readTrimmedQueryString, normaliseImgFormat, parsePositiveInt, buildRequestBaseUrl, sendImgResult, sendImgError } from "./serverHelpers/imageRequests.ts";
export { updateUsersFile } from "./serverHelpers/chatbotUsers.ts";
export { registerPage } from "./serverHelpers/registration.ts";
export { getChapters, getHtmlPagesFromGithub } from "./serverHelpers/githubContent.ts";
export { generateSessionToken, getClientIp, originAllowsDecrypted } from "./serverHelpers/requestIdentity.ts";
export { isSseResponseWritable, writeSseJson, writeSseComment, removeSseClient, openChatStream, notifyClients, trackChatChanges } from "./serverHelpers/chatStream.ts";
export type { OpenChatStreamOptions } from "./serverHelpers/chatStream.ts";
export { resolveStoryPath, exploreStories } from "./serverHelpers/stories.ts";
export { genSiteMap } from "./serverHelpers/sitemap.ts";
export { readVisitSource } from "./serverHelpers/visitSources.ts";
export { getInternalPresence, getPublicPresence, psGrepSSHD } from "./serverHelpers/presence.ts";
export { isBuildManifest, normalisManifest, getBuildManifestPath, readBuildKeyHeader, hasValidBuildKey, readBuildManifest, writeBuildManifest, updateManifest } from "./serverHelpers/buildManifest.ts";
export type { BuildManifest } from "./serverHelpers/buildManifest.ts";
export { readNtcs } from "./serverHelpers/notices.ts";
export { normVisitOrig, normVstSiteParam, matchOrig } from "./serverHelpers/visitOrigins.ts";
