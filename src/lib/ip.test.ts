import { isIP as nodeIsIP } from "node:net";
import { describe, expect, it } from "vitest";
import * as desktop from "@desktop-main/net/ip";
import * as ported from "./ip";

const SAMPLES = [
  "0.0.0.0",
  "10.64.0.1",
  "255.255.255.255",
  "256.1.1.1",
  "01.2.3.4",
  "1.2.3",
  "1.2.3.4.5",
  " 1.2.3.4",
  "::",
  "::1",
  "fe80::1%eth0",
  "fd00:6d61:6e74::7",
  "2001:db8::31",
  "2001:0db8:0000:0000:0000:0000:0000:0001",
  "::ffff:192.0.2.1",
  "1::2::3",
  "12345::",
  "gggg::",
  "fd00::/7",
  "example.com",
  "",
  "1:2:3:4:5:6:7:8",
  "1:2:3:4:5:6:7:8:9",
  "1:2:3:4:5:6:1.2.3.4",
];

describe("ported ip helpers", () => {
  it("isIP matches node:net for all samples", () => {
    for (const sample of SAMPLES) expect([sample, ported.isIP(sample)]).toEqual([sample, nodeIsIP(sample)]);
  });

  it("parses, merges and renders ranges exactly like the desktop module", () => {
    const cidrs = ["10.0.0.0/8", "10.64.0.1/32", "fc00::/7", "fe80::/10", "192.168.1.0/24", "0.0.0.0/1", "2001:db8::/32"];
    expect(ported.cidrRanges(cidrs)).toEqual(desktop.cidrRanges(cidrs));
    const lan = desktop.cidrRanges(["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "fc00::/7"]);
    for (const family of [4, 6] as const) {
      expect(ported.rangesToCidrs(ported.complementRanges(family, lan))).toEqual(
        desktop.rangesToCidrs(desktop.complementRanges(family, lan)),
      );
    }
    expect(ported.isValidCidr("10.0.0.0/33")).toBe(desktop.isValidCidr("10.0.0.0/33"));
    expect(ported.formatAddress(6, 1n)).toBe(desktop.formatAddress(6, 1n));
  });
});
