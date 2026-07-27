import { describe, expect, test } from "bun:test";
import {
  MutexProtoBuffStore,
  ProtoBuffObjectCodec,
  Server
} from "../src/index.ts";

describe("@kittycrypto/server public API", () => {
  test("exports the stable server and storage constructors", () => {
    expect(typeof Server).toBe("function");
    expect(typeof MutexProtoBuffStore).toBe("function");
    expect(typeof ProtoBuffObjectCodec).toBe("function");
  });
});
