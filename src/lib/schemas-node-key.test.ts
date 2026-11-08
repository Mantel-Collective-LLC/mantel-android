import { describe, expect, it } from "vitest";
import { nodeSchema } from "./schemas";

const base = { id: "hk-1", city: "Hongkong", country: "HK", endpointHost: "198.51.100.7", endpointPort: 51820, online: true };

describe("nodeSchema.serverPublicKey", () => {
  it("is optional; invalid values count as missing", () => {
    expect(nodeSchema.parse(base).serverPublicKey).toBeUndefined();
    expect(nodeSchema.parse({ ...base, serverPublicKey: "x" }).serverPublicKey).toBeUndefined();
    expect(nodeSchema.parse({ ...base, serverPublicKey: "HIgo9xNzJMWLKASShiTqIybxZ0U3wGLiUeJ1PKf8ykw=" }).serverPublicKey).toBe("HIgo9xNzJMWLKASShiTqIybxZ0U3wGLiUeJ1PKf8ykw=");
  });
});
