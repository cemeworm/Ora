import { describe, it, expect, vi, beforeEach } from "vitest";
import { Cache, CacheSerialization, jsonSerialization } from "./interface.js";

describe("Cache interface & serialization", () => {
  describe("jsonSerialization", () => {
    it("serializes and deserializes objects", () => {
      const obj = { a: 1, b: "two" };
      const raw = jsonSerialization.serialize(obj);
      expect(typeof raw).toBe("string");
      expect(jsonSerialization.deserialize(raw)).toEqual(obj);
    });

    it("serializes null", () => {
      expect(jsonSerialization.deserialize(jsonSerialization.serialize(null))).toBeNull();
    });

    it("serializes arrays", () => {
      const arr = [1, 2, 3];
      expect(jsonSerialization.deserialize(jsonSerialization.serialize(arr))).toEqual(arr);
    });

    it("throws on undefined", () => {
      expect(() => jsonSerialization.serialize(undefined)).toThrow("Cache does not support storing `undefined`");
    });
  });

  describe("Cache type contract", () => {
    it("interface can be implemented without runtime error", () => {
      // Compile-time check only — interface is structurally typed.
      const impl: Cache<number> = {
        get: async () => undefined,
        set: async () => {},
        del: async () => 0,
        has: async () => false,
        clear: async () => {},
        disconnect: async () => {},
      };
      expect(typeof impl.get).toBe("function");
    });
  });
});
