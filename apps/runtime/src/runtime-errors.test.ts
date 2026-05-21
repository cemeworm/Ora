import { describe, it, expect } from "vitest";
import { OraRuntimeError } from "./runtime-errors.js";

describe("OraRuntimeError", () => {
  it("creates an error with a message", () => {
    const error = new OraRuntimeError("Something went wrong");
    expect(error).toBeInstanceOf(OraRuntimeError);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe("Something went wrong");
    expect(error.code).toBe(-32000);
    expect(error.data).toBeUndefined();
  });

  it("accepts a custom error code", () => {
    const error = new OraRuntimeError("Not found", -32601);
    expect(error.message).toBe("Not found");
    expect(error.code).toBe(-32601);
  });

  it("accepts custom data payload", () => {
    const data = { detail: "Missing field 'name'" };
    const error = new OraRuntimeError("Validation failed", -32000, data);
    expect(error.data).toEqual(data);
  });

  it("preserves stack trace", () => {
    const error = new OraRuntimeError("Stack check");
    expect(error.stack).toBeDefined();
    expect(error.stack!.length).toBeGreaterThan(20);
  });

  it("works with try/catch", () => {
    const fn = () => {
      throw new OraRuntimeError("Thrown error", -32001);
    };
    expect(() => fn()).toThrow(OraRuntimeError);
    expect(() => fn()).toThrow("Thrown error");

    try {
      fn();
    } catch (e) {
      expect(e).toBeInstanceOf(OraRuntimeError);
      expect((e as OraRuntimeError).code).toBe(-32001);
    }
  });
});
