import { describe, expect, test } from "bun:test";
import { encode as encodePng } from "@cf-wasm/png";
import {
    ImageTransformer,
    ImageTransformError,
    toImageTransformErrorBody,
    createImageTransformErrorBody
} from "../src/imageTransformer";

const transformer = new ImageTransformer();
const bytes = (value: string): Uint8Array => new TextEncoder().encode(value);

describe("ImageTransformer compatibility", () => {
    test("preserves the original class constructor and exported errors", () => {
        expect(typeof ImageTransformer).toBe("function");
        expect(typeof ImageTransformError).toBe("function");
        expect(typeof toImageTransformErrorBody).toBe("function");
        expect(typeof createImageTransformErrorBody).toBe("function");
    });

    test("transforms SVG bytes and reports their original dimensions", async () => {
        const original = '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="3"><rect width="4" height="3" fill="red"/></svg>';
        const output = await transformer.transformBytes({ bytes: bytes(original), format: "svg" });
        expect(output.outputFormat).toBe("svg");
        expect(output.detectedSrcFormat).toBe("svg");
        expect(output.contentType).toBe("image/svg+xml");
        expect(output.width).toBe(4);
        expect(output.height).toBe(3);
        expect(new TextDecoder().decode(output.body)).toContain("<svg");
    });

    test("keeps WebP as an unchanged pass-through", async () => {
        const webp = Uint8Array.from([82, 73, 70, 70, 4, 0, 0, 0, 87, 69, 66, 80]);
        const output = await transformer.transformBytes({ bytes: webp });
        expect(output.outputFormat).toBe("webp");
        expect(output.body).toEqual(webp);
        expect(output.width).toBe(0);
        expect(output.height).toBe(0);
    });

    test("rejects WebP resize with the existing error code and stage", async () => {
        const webp = Uint8Array.from([82, 73, 70, 70, 4, 0, 0, 0, 87, 69, 66, 80]);
        try {
            await transformer.transformBytes({ bytes: webp, resize: { width: 10 } });
            throw new Error("Expected unsupported transformation");
        } catch (error) {
            expect(error).toBeInstanceOf(ImageTransformError);
            expect(error).toMatchObject({ code: "UNSUPPORTED_FORMAT", stage: "pass-through", httpStatus: 400 });
        }
    });

    test("preserves GIF byte-for-byte pass-through with dimensions", async () => {
        const gif = new Uint8Array(Buffer.from("R0lGODlhAQABAAD/ACwAAAAAAQABAAACAUwAOw==", "base64"));
        const output = await transformer.transformBytes({ bytes: gif, format: "gif" });
        expect(output.body).toEqual(gif);
        expect(output.contentType).toBe("image/gif");
        expect([output.width, output.height]).toEqual([1, 1]);
    });

    test("decodes, resizes and re-encodes PNG", async () => {
        const pixels = Uint8Array.from([255, 0, 0, 255, 0, 0, 255, 255]);
        const input = encodePng(pixels, 2, 1);
        const result = await transformer.transformBytes({
            bytes: input,
            format: "png",
            resize: { width: 1, height: 1 }
        });
        expect(result.detectedSrcFormat).toBe("png");
        expect(result.outputFormat).toBe("png");
        expect([result.width, result.height]).toEqual([1, 1]);
        expect(result.contentType).toBe("image/png");
        expect([...result.body.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    });

    test("retains source byte limits", async () => {
        const limited = new ImageTransformer({ maxSrcBytes: 3 });
        try {
            await limited.transformBytes({ bytes: bytes("1234"), srcFormatHint: "svg" });
            throw new Error("Expected payload limit to reject");
        } catch (error) {
            expect(error).toBeInstanceOf(ImageTransformError);
            expect(error).toMatchObject({ code: "PAYLOAD_TOO_LARGE", stage: "read-source-body" });
        }
    });

    test("keeps error response serialization shape", () => {
        const error = new ImageTransformError({ code: "BAD_REQUEST", httpStatus: 400, stage: "parse-source-url", message: "Bad URL" });
        expect(toImageTransformErrorBody(error)).toEqual({
            ok: false,
            error: {
                code: "BAD_REQUEST",
                httpStatus: 400,
                message: "Bad URL",
                stage: "parse-source-url",
                details: {}
            }
        });
        expect(createImageTransformErrorBody({ code: "BAD_REQUEST", httpStatus: 400, stage: "parse-source-url", message: "Bad URL" })).toEqual(toImageTransformErrorBody(error));
    });
    test("preserves all original named exports at the historical import path", async () => {
        const { readFileSync } = await import("node:fs");
        const path = await import("node:path");
        const ts = await import("typescript");
        const file = path.resolve(import.meta.dir, "../src/imageTransformer.ts");
        const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
        const names: string[] = [];
        for (const statement of source.statements) {
            if (ts.isClassDeclaration(statement) && statement.name && statement.modifiers?.some(mod => mod.kind === ts.SyntaxKind.ExportKeyword)) {
                names.push(statement.name.text);
            }
            if (ts.isExportDeclaration(statement) && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
                names.push(...statement.exportClause.elements.map(el => el.name.text));
            }
        }
        expect(names.sort()).toEqual([
            "ImageTransformError", "ImageTransformErrorBody", "ImageTransformErrorDetails",
            "ImageTransformer", "ImageTransformerOptions", "ResizeSpec", "SupportedFormat",
            "TransformBytesInput", "TransformErrorCode", "TransformErrorStage", "TransformRemoteUrlInput",
            "TransformResult", "createImageTransformErrorBody", "toImageTransformErrorBody"
        ]);
    });

    test("keeps output codecs for PNG, JPEG, BMP, GIF and TIFF available", async () => {
        const source = encodePng(Uint8Array.from([255, 50, 0, 255]), 1, 1);
        const outputs = [
            ["png", "image/png"],
            ["jpeg", "image/jpeg"],
            ["bmp", "image/bmp"],
            ["gif", "image/gif"],
            ["tiff", "image/tiff"]
        ] as const;
        for (const [format, contentType] of outputs) {
            const result = await transformer.transformBytes({ bytes: source, format });
            expect(result.outputFormat).toBe(format);
            expect(result.contentType).toBe(contentType);
            expect(result.body.byteLength).toBeGreaterThan(0);
            expect([result.width, result.height]).toEqual([1, 1]);
        }
    });

    test("rejects disallowed remote sources without fetching them", async () => {
        try {
            await transformer.transformRemoteUrl({ src: "http://127.0.0.1/private.png" });
            throw new Error("Expected source policy to reject");
        } catch (error) {
            expect(error).toBeInstanceOf(ImageTransformError);
            expect(error).toMatchObject({ code: "BAD_REQUEST", httpStatus: 403, stage: "validate-source-url" });
        }
    });

});
