// Turns a mask (the same JSON the editor saves) into an ffmpeg filter graph. Pure, so it's
// unit-tested without ffmpeg. Region coordinates are 0..1 of the frame; filters run at the
// source size, and the result is scaled to the export height at the end.
//
// - erase box   -> delogo (blends the box from the pixels around it)
// - erase brush -> removelogo with a mask image of the stroke (any shape)
// - keep area   -> the original's pixels laid back on top, so nothing inside changes
// Every filter is limited to the zone's time range with `enable`.

/** @typedef {{ x: number, y: number }} Pt */
/** @typedef {{ id: string, kind: "erase" | "protect", shape?: "rect" | "brush", points?: Pt[], size?: number, x: number, y: number, w: number, h: number, tStartMs: number, tEndMs: number | null }} Region */

function px(r, W, H) {
  const x0 = Math.max(0, Math.floor(r.x * W)), y0 = Math.max(0, Math.floor(r.y * H));
  // The tiny tolerance stops 0.15 * 720 = 108.00000000000001 from rounding up to 109.
  const x1 = Math.min(W, Math.ceil((r.x + r.w) * W - 1e-6)), y1 = Math.min(H, Math.ceil((r.y + r.h) * H - 1e-6));
  return { x0, y0, x1, y1 };
}

const secs = (ms) => String(Math.round(ms) / 1000);

/** `:enable=...` for a time range, or "" when the zone covers the whole video. */
function enable(r) {
  const a = r.tStartMs ?? 0, b = r.tEndMs;
  if (b == null) return a > 0 ? `:enable='gte(t,${secs(a)})'` : "";
  return `:enable='between(t,${secs(a)},${secs(b)})'`;
}

const timeKey = (r) => `${r.tStartMs ?? 0}-${r.tEndMs ?? "end"}`;

/**
 * Binary PGM (P5), W×H, white where any of the strokes paints. removelogo reads it as the
 * shape to remove. Circles are stamped along each segment, like the browser renderer does.
 * @param {Region[]} strokes
 */
export function brushMaskPgm(strokes, W, H) {
  const header = Buffer.from(`P5\n${W} ${H}\n255\n`);
  const px8 = Buffer.alloc(W * H);
  for (const r of strokes) {
    const pts = r.points ?? [];
    const rad = Math.max(1, ((r.size ?? 0.02) * W) / 2);
    const stamp = (cx, cy) => {
      for (let y = Math.max(0, Math.floor(cy - rad)); y <= Math.min(H - 1, Math.ceil(cy + rad)); y++)
        for (let x = Math.max(0, Math.floor(cx - rad)); x <= Math.min(W - 1, Math.ceil(cx + rad)); x++) {
          const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
          if (dx * dx + dy * dy <= rad * rad) px8[y * W + x] = 255;
        }
    };
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[Math.min(i + 1, pts.length - 1)];
      const ax = a.x * W, ay = a.y * H, bx = b.x * W, by = b.y * H;
      const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / Math.max(1, rad / 2)));
      for (let s = 0; s <= steps; s++) stamp(ax + ((bx - ax) * s) / steps, ay + ((by - ay) * s) / steps);
    }
  }
  return Buffer.concat([header, px8]);
}

/**
 * @param {{ regions: Region[] }} mask
 * @param {number} W source width
 * @param {number} H source height
 * @param {number} outHeight the export's height (never above the source)
 * @returns {{ graph: string, masks: { name: string, data: Buffer }[] }}
 */
export function buildFilter(mask, W, H, outHeight) {
  const regions = mask?.regions ?? [];
  const erase = regions.filter((r) => r.kind === "erase");
  const keep = regions.filter((r) => r.kind === "protect");
  const height = Math.min(outHeight, H);
  const tail = `scale=-2:${height},format=yuv420p`;
  if (!erase.length) return { graph: `[0:v]${tail}[out]`, masks: [] };

  const filters = [];
  const masks = [];
  for (const r of erase.filter((r) => r.shape !== "brush")) {
    const p = px(r, W, H);
    // delogo needs a pixel of picture on every side of the box.
    const x0 = Math.max(1, p.x0), y0 = Math.max(1, p.y0);
    const x1 = Math.min(W - 1, p.x1), y1 = Math.min(H - 1, p.y1);
    if (x1 - x0 < 1 || y1 - y0 < 1) continue;
    filters.push(`delogo=x=${x0}:y=${y0}:w=${x1 - x0}:h=${y1 - y0}${enable(r)}`);
  }
  // One mask image per time range, so strokes that share a range are removed in one pass.
  const groups = new Map();
  for (const r of erase.filter((r) => r.shape === "brush" && r.points?.length)) {
    const k = timeKey(r);
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  for (const strokes of groups.values()) {
    const name = `mask-${masks.length}.pgm`;
    masks.push({ name, data: brushMaskPgm(strokes, W, H) });
    filters.push(`removelogo=f=${name}${enable(strokes[0])}`);
  }
  if (!filters.length) return { graph: `[0:v]${tail}[out]`, masks };

  if (!keep.length) return { graph: `[0:v]${filters.join(",")},${tail}[out]`, masks };

  const parts = [`[0:v]split=${keep.length + 1}[base]${keep.map((_, i) => `[k${i}]`).join("")}`, `[base]${filters.join(",")}[c0]`];
  keep.forEach((r, i) => {
    const p = px(r, W, H);
    const w = p.x1 - p.x0, h = p.y1 - p.y0;
    parts.push(`[k${i}]crop=${w}:${h}:${p.x0}:${p.y0}[p${i}]`);
    parts.push(`[c${i}][p${i}]overlay=${p.x0}:${p.y0}${enable(r)}[c${i + 1}]`);
  });
  parts.push(`[c${keep.length}]${tail}[out]`);
  return { graph: parts.join(";"), masks };
}

/** Duration, size and whether there's audio, from `ffmpeg -i`'s banner on stderr. */
export function parseProbe(text) {
  const d = text.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  const durationMs = d ? Math.round(((+d[1] * 60 + +d[2]) * 60 + +d[3]) * 1000) : null;
  const v = text.match(/Stream #\d+:\d+[^\n]*Video:[^\n]*?\b(\d{2,5})x(\d{2,5})\b/);
  return { durationMs, width: v ? +v[1] : null, height: v ? +v[2] : null, hasAudio: /Stream #\d+:\d+[^\n]*Audio:/.test(text) };
}
