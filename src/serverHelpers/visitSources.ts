import type { Request } from "express";

export const readVisitSource = (req: Request): string => {
    const bodySource = typeof req.body?.source === "string" ? req.body.source : "";

    if (bodySource.trim()) {
        return bodySource;
    }

    const querySource = typeof req.query.source === "string" ? req.query.source : "";

    if (querySource.trim()) {
        return querySource;
    }

    return typeof req.headers.referer === "string" ? req.headers.referer : "";
};
