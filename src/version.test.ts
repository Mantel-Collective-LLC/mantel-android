import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import androidPackage from "../package.json";
import { FALLBACK_VERSION } from "./bridge/controller";

const SCHEME = /^(\d{4})\.(\d{1,2})\.(\d{1,3})$/;

function versionCode(version: string): number {
  const match = SCHEME.exec(version);
  if (!match) throw new Error(`${version} is not YEAR.MINOR.PATCH`);
  const [, year, minor, patch] = match.map(Number) as [number, number, number, number];
  return year * 100000 + minor * 1000 + patch;
}

const gradle = readFileSync(fileURLToPath(new URL("../android/app/build.gradle", import.meta.url)), "utf8");

describe("app version", () => {
  it("follows YEAR.MINOR.PATCH and matches the controller fallback", () => {
    expect(androidPackage.version).toMatch(SCHEME);
    expect(FALLBACK_VERSION).toBe(androidPackage.version);
  });

  it("derives the versionCode as YEAR*100000 + MINOR*1000 + PATCH", () => {
    expect(versionCode("2026.0.1")).toBe(202600001);
    expect(versionCode("2026.1.0")).toBe(202601000);
    expect(versionCode("2027.0.0")).toBe(202700000);
    expect(versionCode(androidPackage.version)).toBeGreaterThan(2);
    expect(versionCode("9999.99.999")).toBeLessThan(2_100_000_000);
  });

  it("always increases with the version", () => {
    const ordered = ["2026.0.1", "2026.0.2", "2026.0.999", "2026.1.0", "2026.99.999", "2027.0.0"];
    const codes = ordered.map(versionCode);
    for (let i = 1; i < codes.length; i++) expect(codes[i]).toBeGreaterThan(codes[i - 1]!);
  });

  it("build.gradle derives versionName and versionCode from package.json with the same formula", () => {
    expect(gradle).toMatch(/versionCode mantelVersionCode\b/);
    expect(gradle).toMatch(/versionName mantelVersionName\b/);
    expect(gradle).toContain("'package.json'");
    expect(gradle).toContain(String.raw`/^(\d{4})\.(\d{1,2})\.(\d{1,3})$/`);
    expect(gradle).toMatch(/group\(1\) as int\) \* 100000 \+ \(mantelVersionMatch\.group\(2\) as int\) \* 1000 \+\s+\(mantelVersionMatch\.group\(3\) as int\)/);
    expect(gradle).not.toMatch(/versionCode \d/);
    expect(gradle).not.toMatch(/versionName "/);
  });
});
