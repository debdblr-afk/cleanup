import { describe, expect, it } from "vitest";
import { checkGate, GATE_HOURS, gateOpen, gateToken, sameString } from "./gate";

const T = 1_800_000_000; // a fixed "now" in seconds

describe("passcode gate", () => {
  it("makes a dated, signed token that doesn't contain the passcode", async () => {
    const a = await gateToken("ProjectA01", T);
    expect(a).toBe(await gateToken("ProjectA01", T));
    expect(a).not.toBe(await gateToken("ProjectA02", T));
    expect(a).not.toBe(await gateToken("ProjectA01", T + 1));
    expect(a).not.toContain("ProjectA01");
    expect(a).toMatch(/^\d+\.[A-Za-z0-9_-]{43}$/);
  });
  it(`lets a token in for ${GATE_HOURS} hours, then asks again`, async () => {
    const t = await gateToken("ProjectA01", T);
    expect(await checkGate("ProjectA01", t, T)).toBe("ok");
    expect(await checkGate("ProjectA01", t, T + GATE_HOURS * 3600 - 1)).toBe("ok");
    expect(await checkGate("ProjectA01", t, T + GATE_HOURS * 3600)).toBe("expired");
    expect(await checkGate("ProjectA01", t, T + 30 * 86_400)).toBe("expired");
  });
  it("refuses forged, re-dated, future-dated and old-format tokens, and tokens for another passcode", async () => {
    const t = await gateToken("ProjectA01", T);
    const [, sig] = t.split(".");
    expect(await checkGate("ProjectA01", `${T + 3600}.${sig}`, T + 3600)).toBe("bad"); // re-dated
    expect(await checkGate("ProjectA02", t, T)).toBe("bad"); // passcode changed
    expect(await checkGate("ProjectA01", await gateToken("ProjectA01", T + 3600), T)).toBe("bad"); // from the future
    expect(await checkGate("ProjectA01", sig, T)).toBe("bad"); // the old undated cookie
    expect(await checkGate("ProjectA01", "forged-value", T)).toBe("bad");
    expect(await checkGate("ProjectA01", "", T)).toBe("bad");
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
