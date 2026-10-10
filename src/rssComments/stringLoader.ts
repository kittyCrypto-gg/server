import fs from "fs";
import type { ModeratorStrings } from "./types";

    export function loadModeratorStrings(stringsFilePath: string): { [key: string]: ModeratorStrings } {
        try {
            const raw = fs.readFileSync(stringsFilePath, "utf-8");
            const parsed = JSON.parse(raw) as unknown;

            if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
                return {};
            }

            return parsed as { [key: string]: ModeratorStrings };
        } catch {
            throw new Error("Could not load moderator strings.");
        }
    }

