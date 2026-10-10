import fs from "fs";
import { getDescriptionsPath } from "./config";
import type { AppDescriptions } from "./types";

let currentDescriptions: AppDescriptions = {};

function isDescriptionObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function refreshAppDescriptions(): Promise<AppDescriptions> {
    try {
        const raw = await fs.promises.readFile(getDescriptionsPath(), "utf8");
        const payload = JSON.parse(raw) as unknown;

        if (!isDescriptionObject(payload)) {
            throw new Error("App descriptions JSON must contain an object keyed by app id.");
        }

        const nextDescriptions: Record<string, string> = {};

        for (const [id, description] of Object.entries(payload)) {
            if (typeof description !== "string") {
                throw new Error(`App description for ${id} must be a string.`);
            }

            nextDescriptions[id] = description.trim();
        }

        currentDescriptions = nextDescriptions;
    } catch (error) {
        console.error(`❌ Failed to load app descriptions from ${getDescriptionsPath()}:`, error);
    }

    return currentDescriptions;
}
