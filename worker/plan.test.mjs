import { describe, expect, it } from "vitest";
import { brushMaskPgm, buildFilter, parseProbe } from "./plan.mjs";

const rect = (p) => ({ id: "r", kind: "erase", shape: "rect", x: 0.8, y: 0.05, w: 0.15, h: 0.1, tStartMs: 0, tEndMs: null, track: false, source: "user", ...p });

describe("buildFilter", () => {
  it("turns an erase box into delogo at source pixels, then scales to the export height", () => {
    const { graph, masks } = buildFilter({ regions: [rect()] }, 1280, 720, 720);
    expect(masks).toEqual([]);
    expect(graph).toContain("delogo=x=1024:y=36:w=192:h=72");
    expect(graph).toContain("scale=-2:720");
    expect(graph.endsWith("[out]")).toBe(true);
  });

  it("limits a timed zone with enable, and never scales above the source", () => {
    const { graph } = buildFilter({ regions: [rect({ tStartMs: 1000, tEndMs: 2500 })] }, 640, 360, 1080);
    expect(graph).toContain("enable='between(t,1,2.5)'");
    expect(graph).toContain("scale=-2:360");
  });

  it("keeps boxes off the frame's outer pixel, which delogo needs", () => {
    const { graph } = buildFilter({ regions: [rect({ x: 0, y: 0, w: 0.2, h: 0.2 })] }, 100, 100, 100);
    expect(graph).toContain("delogo=x=1:y=1:w=19:h=19");
  });

  it("turns brush strokes into a removelogo mask image", () => {
    const brush = { ...rect(), shape: "brush", size: 0.1, points: [{ x: 0.5, y: 0.5 }, { x: 0.6, y: 0.5 }], x: 0.45, y: 0.41, w: 0.2, h: 0.18 };
    const { graph, masks } = buildFilter({ regions: [brush] }, 200, 100, 100);
    expect(masks).toHaveLength(1);
    expect(graph).toContain(`removelogo=f=${masks[0].name}`);
  });

  it("lays the original back over keep areas", () => {
    const { graph } = buildFilter({ regions: [rect(), rect({ id: "k", kind: "protect", x: 0.85, y: 0.06, w: 0.05, h: 0.05 })] }, 1000, 1000, 1000);
    expect(graph).toMatch(/split=2\[base\]\[k0\]/);
    expect(graph).toContain("crop=50:50:850:60");
    expect(graph).toContain("overlay=850:60");
  });

  it("passes the video through untouched with no erase zones", () => {
    const { graph } = buildFilter({ regions: [] }, 640, 360, 720);
    expect(graph).toBe("[0:v]scale=-2:360,format=yuv420p[out]");
  });
});

describe("brushMaskPgm", () => {
  it("writes a binary PGM the size of the frame with the stroke in white", () => {
    const brush = { ...rect(), shape: "brush", size: 0.2, points: [{ x: 0.5, y: 0.5 }], x: 0.4, y: 0.3, w: 0.2, h: 0.4 };
    const pgm = brushMaskPgm([brush], 20, 10);
    const header = "P5\n20 10\n255\n";
    expect(pgm.subarray(0, header.length).toString()).toBe(header);
    const px = pgm.subarray(header.length);
    expect(px.length).toBe(200);
    expect(px[5 * 20 + 10]).toBe(255);
    expect(px[0]).toBe(0);
  });
});

describe("parseProbe", () => {
  it("reads duration, size and audio from ffmpeg's banner", () => {
    const text = `Input #0, matroska,webm, from 'in.webm':
  Duration: 00:01:05.38, start: 0.000000, bitrate: 2210 kb/s
  Stream #0:0: Video: vp8, yuv420p(progressive), 1280x720, SAR 1:1 DAR 16:9, 30 fps
  Stream #0:1: Audio: opus, 48000 Hz, stereo, fltp`;
    expect(parseProbe(text)).toEqual({ durationMs: 65380, width: 1280, height: 720, hasAudio: true });
  });

  it("treats a missing duration (live-recorded WebM) as unknown", () => {
    expect(parseProbe("  Duration: N/A, start: 0.0\n  Stream #0:0: Video: vp8, yuv420p, 640x360")).toEqual({ durationMs: null, width: 640, height: 360, hasAudio: false });
  });
});
