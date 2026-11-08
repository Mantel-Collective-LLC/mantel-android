import { describe, expect, it } from "vitest";
import { wgKey } from "../test/fakes";
import { redact, shortId } from "./redact";
import { RequestLog } from "./request-log";

describe("redact", () => {
  it("blanks account codes, keys, bearer tokens, secret JSON fields and known secrets", () => {
    const key = wgKey(7);
    const text = JSON.stringify({
      note: "Code 1234 5678 1234 5678 und 1234-5678-1234-5678 und 1234567812345678",
      header: "Authorization: Bearer tok_abcdefghijklmnopqrstuvwxyz012345",
      key,
      token: "anything",
      code: "abc",
      free: "my-secret-session-value in text",
      endpoint: "198.51.100.9:51820",
      version: "0.1.0",
    });
    const result = redact(text, ["my-secret-session-value"]);
    expect(result).not.toContain("1234");
    expect(result).not.toContain("tok_abcdefghijklmnopqrstuvwxyz012345");
    expect(result).not.toContain(key);
    expect(result).not.toContain("anything");
    expect(result).not.toContain("my-secret-session-value");
    expect(result).toContain("198.51.100.9:51820");
    expect(result).toContain("0.1.0");
    expect(JSON.parse(result)).toMatchObject({ token: "[redacted]", code: "[redacted]", key: "[key]" });
  });

  it("shortens account ids", () => {
    expect(shortId("acc_7f3a9c21")).toBe("acc_7f…");
    expect(shortId("acc1")).toBe("acc1");
    expect(shortId(null)).toBeNull();
  });
});

describe("RequestLog", () => {
  it("keeps the newest entries up to its capacity and notifies listeners", () => {
    const log = new RequestLog(2);
    let calls = 0;
    log.subscribe(() => calls++);
    for (const route of ["/a", "/b", "/c"]) {
      log.add({ at: 1, method: "GET", route, status: 200, durationMs: 5, error: null });
    }
    expect(log.list().map((entry) => entry.route)).toEqual(["/c", "/b"]);
    log.clear();
    expect(log.list()).toEqual([]);
    expect(calls).toBe(4);
  });
});
