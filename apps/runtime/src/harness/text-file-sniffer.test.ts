import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readTextFile, sniffTextFile } from "./text-file-sniffer.js";

const cleanupPaths: string[] = [];

function tempFile(name: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ora-text-sniffer-"));
  cleanupPaths.push(dir);
  return path.join(dir, name);
}

afterEach(() => {
  for (const cleanupPath of cleanupPaths.splice(0)) {
    fs.rmSync(cleanupPath, { recursive: true, force: true });
  }
});

describe("text file sniffer", () => {
  it("accepts utf8 markdown", () => {
    const filePath = tempFile("note.md");
    fs.writeFileSync(filePath, "# hello\nworld\n", "utf8");
    expect(sniffTextFile(filePath)).toEqual({ kind: "text", encoding: "utf8" });
    expect(readTextFile(filePath, "utf8")).toBe("# hello\nworld\n");
  });

  it("accepts utf8 bom markdown", () => {
    const filePath = tempFile("bom.md");
    fs.writeFileSync(filePath, Buffer.from([0xef, 0xbb, 0xbf, ...Buffer.from("# bom\n", "utf8")]));
    expect(sniffTextFile(filePath)).toEqual({ kind: "text", encoding: "utf8" });
    expect(readTextFile(filePath, "utf8")).toBe("# bom\n");
  });

  it("accepts utf16le markdown", () => {
    const filePath = tempFile("utf16le.md");
    fs.writeFileSync(filePath, Buffer.from([0xff, 0xfe, ...Buffer.from("# u16le\n", "utf16le")]));
    expect(sniffTextFile(filePath)).toEqual({ kind: "text", encoding: "utf16le" });
    expect(readTextFile(filePath, "utf16le")).toBe("# u16le\n");
  });

  it("accepts utf16be markdown", () => {
    const filePath = tempFile("utf16be.md");
    const payload = Buffer.from("# u16be\n", "utf16le");
    const swapped = Buffer.concat([Buffer.from([0xfe, 0xff]), swapUtf16Bytes(payload)]);
    fs.writeFileSync(filePath, swapped);
    expect(sniffTextFile(filePath)).toEqual({ kind: "text", encoding: "utf16be" });
    expect(readTextFile(filePath, "utf16be")).toBe("# u16be\n");
  });

  it("keeps random binary as binary", () => {
    const filePath = tempFile("blob.bin");
    fs.writeFileSync(filePath, Buffer.from([0x00, 0x13, 0x37, 0x00, 0xff, 0x01]));
    expect(sniffTextFile(filePath)).toEqual({ kind: "binary" });
  });

  it("keeps nul-heavy sqlite wal style samples as binary", () => {
    const filePath = tempFile("runtime.db-wal");
    fs.writeFileSync(filePath, Buffer.from([0x00, 0x01, 0x02, 0x53, 0x65, 0x73, 0x73, 0x69, 0x6f, 0x6e]));
    expect(sniffTextFile(filePath)).toEqual({ kind: "binary" });
  });
});

function swapUtf16Bytes(buffer: Buffer): Buffer {
  const swapped = Buffer.alloc(buffer.length);
  for (let index = 0; index < buffer.length; index += 2) {
    swapped[index] = buffer[index + 1] ?? 0;
    swapped[index + 1] = buffer[index] ?? 0;
  }
  return swapped;
}
