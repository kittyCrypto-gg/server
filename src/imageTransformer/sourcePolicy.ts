import fs from "fs";
import { ImageTransformError } from "./errors";


const ALLOWED_IMAGE_SOURCE_HOSTS = new Set<string>([
  "kittycrypto.gg",
]);

const EXTRASOURCES_PATH = "./data/extra_sources.json";
export async function isAllowedImageSourceUrl(u: URL): Promise<boolean> {
  if (u.protocol !== "https:") return false;

  const host = u.hostname.toLowerCase();
  if (host.endsWith(".kittycrypto.gg")) return true;

  const allowedHosts = new Set<string>();
  for (const h of ALLOWED_IMAGE_SOURCE_HOSTS) allowedHosts.add(h.toLowerCase());

  const extraHosts = await readExtraSourceHosts();
  for (const h of extraHosts) allowedHosts.add(h);

  return allowedHosts.has(host);
}

async function readExtraSourceHosts(): Promise<Set<string>> {
  const ensureEmptyFile = async (): Promise<Set<string>> => {
    try {
      await fs.promises.writeFile(EXTRASOURCES_PATH, "{}", "utf-8");
      return new Set<string>();
    } catch (error) {
      console.error(`Failed to create ${EXTRASOURCES_PATH}:`, error);
      throw new ImageTransformError({
        code: "INTERNAL",
        httpStatus: 500,
        message: "Failed to initialise extra image source allowlist",
        stage: "read-allowlist",
        details: {
          path: EXTRASOURCES_PATH,
          action: "create-empty-file",
        },
        cause: error,
      });
    }
  };

  const backupCorruptFile = async (): Promise<void> => {
    const safeStamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupPath = `${EXTRASOURCES_PATH}.bak-${safeStamp}`;

    try {
      await fs.promises.rename(EXTRASOURCES_PATH, backupPath);
    } catch (error) {
      console.error(`Failed to back up corrupt ${EXTRASOURCES_PATH}:`, error);
      throw new ImageTransformError({
        code: "INTERNAL",
        httpStatus: 500,
        message: "Failed to back up corrupt extra image source allowlist",
        stage: "read-allowlist",
        details: {
          path: EXTRASOURCES_PATH,
          backupPath,
          action: "backup-corrupt-file",
        },
        cause: error,
      });
    }
  };

  let raw: string;
  try {
    raw = await fs.promises.readFile(EXTRASOURCES_PATH, "utf-8");
  } catch (error: unknown) {
    const code = error instanceof Error ? (error as NodeJS.ErrnoException).code : undefined;
    if (code === "ENOENT") return ensureEmptyFile();

    console.error(`Failed to read ${EXTRASOURCES_PATH}:`, error);
    throw new ImageTransformError({
      code: "INTERNAL",
      httpStatus: 500,
      message: "Failed to read extra image source allowlist",
      stage: "read-allowlist",
      details: {
        path: EXTRASOURCES_PATH,
        action: "read-file",
      },
      cause: error,
    });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    await backupCorruptFile();
    console.error(`Corrupt ${EXTRASOURCES_PATH} was reset:`, error);
    return ensureEmptyFile();
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    await backupCorruptFile();
    return ensureEmptyFile();
  }

  const obj = parsed as Record<string, unknown>;
  const hosts = new Set<string>();

  for (const value of Object.values(obj)) {
    if (typeof value !== "string") continue;

    const candidate = value.trim().toLowerCase();
    if (candidate.length > 0) hosts.add(candidate);
  }

  return hosts;
}

