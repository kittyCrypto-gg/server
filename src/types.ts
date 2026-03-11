import * as ImageTransformer from "./imageTransformer";
import { Response } from "express";

export type GithubContentItem = {
    type: "file" | "dir";
    name: string;
    path: string;
};

export type ImgQueryOk = {
    ok: true;
    src: string;
    format: ImageTransformer.SupportedFormat | null;
    srcFormatHint: ImageTransformer.SupportedFormat | null;
    resize: { width?: number; height?: number };
};

export type ImgQueryBad = {
    ok: false;
    httpStatus: number;
    message: string;
};
export type ImgQueryParseResult = ImgQueryOk | ImgQueryBad;

export type ImgResultShape = {
    body: Uint8Array;
    contentType: string;
};

export type SseClient = {
    res: Response;
    hasKey: boolean;
};

export type StoriesIndex = Record<string, string[]>;