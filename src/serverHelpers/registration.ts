import fs from "fs";
import path from "path";

export function registerPage(error = "", apiKey = ""): string {
    const registerTemplate = fs.readFileSync(
        path.resolve(import.meta.dir, "../../ui/register.html"),
        "utf-8"
    );

    const escapeHtml = (value: string): string => {
        return value
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll("\"", "&quot;")
            .replaceAll("'", "&#39;");
    };

    const safeApiKey = escapeHtml(apiKey);
    const safeError = escapeHtml(error);

    return registerTemplate
        .replace("{{API_KEY_ATTR}}", safeApiKey)
        .replace("{{API_KEY_DISPLAY}}", safeApiKey || "(empty)")
        .replace(
            "{{ERROR_BLOCK}}",
            safeError ? `<div class="error">${safeError}</div>` : ""
        );
}
