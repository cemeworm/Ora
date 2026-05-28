import fs from "node:fs";
import path from "node:path";

const SNIFF_BYTES = 4096;
const PRINTABLE_ASCII_RE = /[\x09\x0A\x0D\x20-\x7E]/g;
const KNOWN_BINARY_SUFFIXES = [".db", ".db-shm", ".db-wal", ".sqlite", ".sqlite-shm", ".sqlite-wal", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".pdf"];

export type TextFileEncoding = "utf8" | "utf16le" | "utf16be";

export type SniffedTextFile =
  | { kind: "text"; encoding: TextFileEncoding }
  | { kind: "binary" };

const utf8Decoder = new TextDecoder("utf-8", { fatal: false });
const utf16leDecoder = new TextDecoder("utf-16le");
const utf16beDecoder = new TextDecoder("utf-16be");

export function sniffTextFile(filePath: string): SniffedTextFile {
  if (hasKnownBinarySuffix(filePath)) {
    return { kind: "binary" };
  }
  const fd = fs.openSync(filePath, "r");
  try {
    const buffer = Buffer.alloc(SNIFF_BYTES);
    const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, 0);
    if (bytesRead === 0) {
      return { kind: "text", encoding: "utf8" };
    }

    const sample = buffer.subarray(0, bytesRead);
    const bomEncoding = detectBomEncoding(sample);
    if (bomEncoding) {
      return { kind: "text", encoding: bomEncoding };
    }

    if (looksLikeUtf16Text(sample)) {
      return { kind: "text", encoding: sample[0] === 0 ? "utf16be" : "utf16le" };
    }

    if (containsNullByte(sample) && printableByteRatio(sample) < 0.6) {
      return { kind: "binary" };
    }

    const utf8 = new TextDecoder("utf-8", { fatal: false }).decode(sample);
    if (utf8.includes("\uFFFD") && !looksLikeMostlyText(utf8)) {
      return { kind: "binary" };
    }

    return { kind: "text", encoding: "utf8" };
  } finally {
    fs.closeSync(fd);
  }
}

export function readTextFile(filePath: string, encoding: TextFileEncoding): string {
  const data = stripBom(fs.readFileSync(filePath), encoding);
  if (encoding === "utf16be") {
    return utf16beDecoder.decode(data);
  }
  if (encoding === "utf16le") {
    return utf16leDecoder.decode(data);
  }
  return utf8Decoder.decode(data);
}

function detectBomEncoding(sample: Buffer): "utf8" | "utf16le" | "utf16be" | undefined {
  if (sample.length >= 3 && sample[0] === 0xef && sample[1] === 0xbb && sample[2] === 0xbf) {
    return "utf8";
  }
  if (sample.length >= 2 && sample[0] === 0xff && sample[1] === 0xfe) {
    return "utf16le";
  }
  if (sample.length >= 2 && sample[0] === 0xfe && sample[1] === 0xff) {
    return "utf16be";
  }
  return undefined;
}

function stripBom(data: Buffer, encoding: TextFileEncoding): Buffer {
  if (encoding === "utf8" && data.length >= 3 && data[0] === 0xef && data[1] === 0xbb && data[2] === 0xbf) {
    return data.subarray(3);
  }
  if (encoding === "utf16le" && data.length >= 2 && data[0] === 0xff && data[1] === 0xfe) {
    return data.subarray(2);
  }
  if (encoding === "utf16be" && data.length >= 2 && data[0] === 0xfe && data[1] === 0xff) {
    return data.subarray(2);
  }
  return data;
}

function hasKnownBinarySuffix(filePath: string): boolean {
  const basename = path.basename(filePath).toLowerCase();
  return KNOWN_BINARY_SUFFIXES.some((suffix) => basename.endsWith(suffix));
}

function looksLikeUtf16Text(sample: Buffer): boolean {
  if (sample.length < 4) {
    return false;
  }
  let evenNulls = 0;
  let oddNulls = 0;
  let totalNulls = 0;
  let printable = 0;
  for (let index = 0; index < sample.length; index += 1) {
    const byte = sample[index]!;
    if (byte === 0) {
      totalNulls += 1;
      if (index % 2 === 0) evenNulls += 1;
      else oddNulls += 1;
    } else if (isLikelyTextByte(byte)) {
      printable += 1;
    }
  }
  if (totalNulls === 0) {
    return false;
  }
  const dominantParity = Math.max(evenNulls, oddNulls) / totalNulls;
  const nullRatio = totalNulls / sample.length;
  const printableRatio = printable / sample.length;
  return dominantParity >= 0.8 && nullRatio >= 0.2 && printableRatio >= 0.2;
}

function containsNullByte(sample: Buffer): boolean {
  for (let index = 0; index < sample.length; index += 1) {
    if (sample[index] === 0) return true;
  }
  return false;
}

function looksLikeMostlyText(text: string): boolean {
  const printable = (text.match(PRINTABLE_ASCII_RE) ?? []).length;
  return printable / Math.max(text.length, 1) >= 0.6;
}

function printableByteRatio(sample: Buffer): number {
  let printable = 0;
  for (let index = 0; index < sample.length; index += 1) {
    if (isLikelyTextByte(sample[index]!)) {
      printable += 1;
    }
  }
  return printable / Math.max(sample.length, 1);
}

function isLikelyTextByte(byte: number): boolean {
  return byte === 0x09 || byte === 0x0a || byte === 0x0d || (byte >= 0x20 && byte <= 0x7e);
}
