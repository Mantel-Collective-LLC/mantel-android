import { describe, expect, it } from "vitest";
import { nodeSchema, nodesSchema } from "./schemas";

const base = { id: "ch-zrh", city: "Zürich", country: "CH", endpointHost: "198.51.100.7", endpointPort: 51820, online: true, latencyMs: 11 };

describe("nodeSchema.postQuantum", () => {
  it("takes true/false from the server", () => {
    expect(nodeSchema.parse({ ...base, postQuantum: true }).postQuantum).toBe(true);
    expect(nodeSchema.parse({ ...base, postQuantum: false }).postQuantum).toBe(false);
  });

  it("is false when an older server does not send the field", () => {
    expect(nodeSchema.parse(base).postQuantum).toBe(false);
    expect(nodesSchema.parse([base, { ...base, id: "de-fra", postQuantum: true }]).map((node) => node.postQuantum)).toEqual([false, true]);
  });

  it("rejects a non-boolean value instead of guessing", () => {
    expect(nodeSchema.safeParse({ ...base, postQuantum: "true" }).success).toBe(false);
  });
});
