// ui/src/lib/format.test.ts
import { describe, it, expect } from "vitest";
import { formatBytes, formatPct, shortId, cleanName, prettyJson } from "./format";

describe("formatBytes", () => {
  it("handles zero and falsy", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(undefined)).toBe("—");
    expect(formatBytes(null)).toBe("—");
  });
  it("scales binary units", () => {
    expect(formatBytes(1024)).toBe("1.0 KiB");
    expect(formatBytes(1024 * 1024)).toBe("1.0 MiB");
    expect(formatBytes(1536)).toBe("1.5 KiB");
  });
});

describe("formatPct", () => {
  it("formats one decimal", () => {
    expect(formatPct(12.345)).toBe("12.3%");
    expect(formatPct(undefined)).toBe("—");
  });
});

describe("shortId", () => {
  it("trims sha256 prefix and length", () => {
    expect(shortId("sha256:abcdef0123456789", 6)).toBe("abcdef");
    expect(shortId("abcdef0123456789")).toBe("abcdef012345");
    expect(shortId(undefined)).toBe("—");
  });
});

describe("cleanName", () => {
  it("strips leading slash from docker names", () => {
    expect(cleanName("/web")).toBe("web");
    expect(cleanName("web")).toBe("web");
    expect(cleanName(undefined)).toBe("—");
  });
});

describe("prettyJson", () => {
  it("indents objects", () => {
    expect(prettyJson({ a: 1 })).toBe('{\n  "a": 1\n}');
  });
});
