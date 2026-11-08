import { describe, expect, it } from "vitest";
import { gateOpen, gateToken, sameString } from "./gate";

describe("passcode gate", () => {
  it("makes the same token for the same passcode, a different one otherwise", async () => {
    const a = await gateToken("ddashjunior");
    expect(a).toBe(await gateToken("ddashjunior"));
    expect(a).not.toBe(await gateToken("ddashjunior2"));
    expect(a).not.toContain("ddashjunior");
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
  it("compares strings without short-circuiting", () => {
    expect(sameString("abc", "abc")).toBe(true);
    expect(sameString("abc", "abd")).toBe(false);
    expect(sameString("abc", "abcd")).toBe(false);
    expect(sameString("", "")).toBe(true);
  });
  it("keeps only the entry page, machine routes and preview assets open", () => {
    for (const p of ["/enter", "/api/enter", "/api/cron/expire", "/api/worker/server/claim", "/icon.svg", "/opengraph-image"]) expect(gateOpen(p)).toBe(true);
    for (const p of ["/", "/b/x", "/account", "/api/videos", "/api/worker/claim", "/legal/privacy", "/enterprise"]) expect(gateOpen(p)).toBe(false);
  });
});
