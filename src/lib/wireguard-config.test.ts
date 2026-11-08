import { describe, expect, it } from "vitest";
import * as desktop from "@desktop-main/wireguard/config";
import { buildTunnelConfig, leakProtectionFor, parseEndpoint, planAllowedIps, type ServerTunnelConfig } from "./wireguard-config";

const server: ServerTunnelConfig = {
  address: ["10.64.0.7/32", "fd00:6d61:6e74::7/128"],
  dns: ["10.64.0.1", "fd00:6d61:6e74::1"],
  serverPublicKey: "xTIBA5rboUvnH4htodjb6e697QjLERt1NAB4mZqp8Dg=",
  presharedKey: "XgPRso34lnrSAx8nJtdj1/zlF7CoNj7B64LPElYdOGs=",
  endpoint: "198.51.100.7:51820",
  allowedIps: ["0.0.0.0/0", "::/0"],
  mtu: 1420,
};
const privateKey = "yAnz5TF+lXXJte14tji3zlMNq+hd2rYUIgJBgB3fBmk=";

const COMBINATIONS = [false, true].flatMap((killSwitch) =>
  [false, true].flatMap((lanAccess) => [false, true].map((ipv6) => ({ killSwitch, lanAccess, ipv6 }))),
);

describe("ported wireguard config", () => {
  it("renders the same config as the desktop app for every routing combination (IP endpoint)", () => {
    for (const endpoint of [
      { host: "198.51.100.7", port: 51820 },
      { host: "2001:db8::31", port: 51820 },
    ]) {
      for (const settings of COMBINATIONS) {
        const mine = buildTunnelConfig({ privateKey, server, endpoint, settings });
        const theirs = desktop.buildTunnelConfig({ privateKey, server, endpoint, settings });
        expect(mine.text).toBe(theirs.text.replace(/\r\n/g, "\n"));
        expect(mine.addresses).toEqual(theirs.addresses);
        expect(mine.dns).toEqual(theirs.dns);
        expect(mine.allowedIps).toEqual(theirs.allowedIps);
        expect(planAllowedIps(settings, mine.dns)).toEqual(desktop.planRouting(settings, mine.dns).allowedIps);
      }
    }
  });

  it("keeps host name endpoints for wireguard-go to resolve", () => {
    const settings = { killSwitch: true, lanAccess: false, ipv6: true };
    const config = buildTunnelConfig({ privateKey, server, endpoint: { host: "fra-1.vpn.example", port: 51820 }, settings });
    expect(config.text).toContain("Endpoint = fra-1.vpn.example:51820");
    for (const host of ["bad host", "a..b", "-x.example", "x\nPostUp = rm -rf /"]) {
      expect(() => buildTunnelConfig({ privateKey, server, endpoint: { host, port: 51820 }, settings })).toThrow();
    }
    expect(() => buildTunnelConfig({ privateKey, server, endpoint: { host: "x.example", port: 0 }, settings })).toThrow();
  });

  it("rejects bad keys and missing IPv4", () => {
    const settings = { killSwitch: true, lanAccess: false, ipv6: true };
    const endpoint = { host: "198.51.100.7", port: 51820 };
    expect(() => buildTunnelConfig({ privateKey: "kaputt", server, endpoint, settings })).toThrow("Ungültiger privater Schlüssel.");
    expect(() => buildTunnelConfig({ privateKey, server: { ...server, serverPublicKey: "x" }, endpoint, settings })).toThrow();
    expect(() => buildTunnelConfig({ privateKey, server: { ...server, address: ["fd00::7/128"] }, endpoint, settings })).toThrow(
      "Der Server hat keine IPv4-Adresse zugewiesen.",
    );
  });

  it("parses endpoints like the desktop app", () => {
    for (const value of ["198.51.100.7:51820", "[2001:db8::1]:51820", "node.example:1", "node.example:0", "[node]:1", "x:99999"]) {
      expect(parseEndpoint(value)).toEqual(desktop.parseEndpoint(value));
    }
  });

  it("only promises WireGuard leak protection when everything is routed into the tunnel", () => {
    expect(leakProtectionFor({ killSwitch: true, lanAccess: false })).toBe("wireguard");
    expect(leakProtectionFor({ killSwitch: true, lanAccess: true })).toBe("firewall");
    expect(leakProtectionFor({ killSwitch: false, lanAccess: true })).toBe("none");
    expect(leakProtectionFor({ killSwitch: false, lanAccess: false })).toBe("none");
  });
});
