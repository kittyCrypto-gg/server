import { describe, expect, test } from "bun:test";
import { normaliseCommentPage } from "../src/serverHelpers";

describe("normaliseCommentPage", () => {
    test("treats clean, slash and legacy html routes as the same page", () => {
        const variants = [
            "/reader",
            "/reader/",
            "/reader.html",
            "/reader.html/"
        ];

        expect(variants.map(normaliseCommentPage)).toEqual([
            "/reader",
            "/reader",
            "/reader",
            "/reader"
        ]);
    });

    test("preserves query strings so comment sections remain query-specific", () => {
        expect(normaliseCommentPage("/reader/?story=Alpha&chapter=1"))
            .toBe("/reader?story=Alpha&chapter=1");

        expect(normaliseCommentPage("/reader.html/?story=Alpha&chapter=1"))
            .toBe("/reader?story=Alpha&chapter=1");

        expect(normaliseCommentPage("/reader/?story=Alpha&chapter=2"))
            .toBe("/reader?story=Alpha&chapter=2");
    });

    test("normalises legacy index routes to the site root", () => {
        expect(normaliseCommentPage("/")).toBe("/");
        expect(normaliseCommentPage("/index")).toBe("/");
        expect(normaliseCommentPage("/index/")).toBe("/");
        expect(normaliseCommentPage("/index.html")).toBe("/");
        expect(normaliseCommentPage("/index.html/")).toBe("/");
    });
});
