import { ImageResponse } from "next/og";

// The preview card shown when a link to the site is shared. Colours match the placeholder
// tokens (accent #0a6b58 on Cloud Dancer #f0eee9) until /replica-brand picks the real palette.
export const alt = "Cleanup: remove logos and text from your videos";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "center", padding: 80, background: "#f0eee9", fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div style={{ width: 72, height: 72, borderRadius: 16, background: "#0a6b58", color: "#f8f7f4", fontSize: 44, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>C</div>
          <div style={{ fontSize: 44, fontWeight: 700, color: "#111418" }}>Cleanup</div>
        </div>
        <div style={{ marginTop: 48, fontSize: 76, fontWeight: 800, color: "#111418", lineHeight: 1.05 }}>Take the logo off your video</div>
        <div style={{ marginTop: 28, fontSize: 34, color: "#4b5563" }}>Your own watermarks, captions and stray text. Free 5-second preview.</div>
      </div>
    ),
    size,
  );
}
