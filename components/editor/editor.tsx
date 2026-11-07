"use client";
import { ArrowLeft, Brush, Download, Pause, Play, Redo2, SquareDashed, Trash2, Undo2, Volume2, VolumeX } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BeforeAfter } from "@/components/batch/before-after";
import { baseName } from "@/components/batch/file-card";
import { ExportDialog } from "@/components/export/export-dialog";
import { buttonClass, Button, IconButton, ProgressBar, StatusBadge, Switch } from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";
import { useFileUrl, useStore } from "@/lib/data/hooks";
import { cancelJob, createJob, effectiveMask, jobsFor } from "@/lib/data/store";
import { formatClock, formatDuration, timeAgo, uid } from "@/lib/format";
import { describeRegion, hasErase, MIN_REGION, normalizeRegion } from "@/lib/mask";
import { PREVIEW_MS } from "@/lib/plans";
import type { Job, Mask, Region, RemovalMode, Video } from "@/lib/types";

type Drag =
  | { kind: "draw"; x0: number; y0: number; id: string }
  | { kind: "move"; id: string; dx: number; dy: number; start: Region }
  | { kind: "resize"; id: string; start: Region };

const MODES: { id: RemovalMode; label: string; ready: boolean }[] = [
  { id: "watermark", label: "Watermark or logo", ready: true },
  { id: "subtitle", label: "Subtitles (coming soon)", ready: false },
  { id: "text", label: "Text (coming soon)", ready: false },
  { id: "object", label: "Object (coming soon)", ready: false },
  { id: "person", label: "Person (coming soon)", ready: false },
];

function useHistory(initial: Mask) {
  const [stack, setStack] = useState<{ items: Mask[]; i: number }>({ items: [initial], i: 0 });
  const current = stack.items[stack.i];
  const push = useCallback((m: Mask) => setStack((s) => ({ items: [...s.items.slice(0, s.i + 1), m].slice(-100), i: Math.min(s.i + 1, 99) })), []);
  const replace = useCallback((m: Mask) => setStack((s) => ({ items: s.items.map((x, k) => (k === s.i ? m : x)), i: s.i })), []);
  const reset = useCallback((m: Mask) => setStack({ items: [m], i: 0 }), []);
  const undo = useCallback(() => setStack((s) => ({ ...s, i: Math.max(0, s.i - 1) })), []);
  const redo = useCallback(() => setStack((s) => ({ ...s, i: Math.min(s.items.length - 1, s.i + 1) })), []);
  return { current, push, replace, reset, undo, redo, canUndo: stack.i > 0, canRedo: stack.i < stack.items.length - 1, pristine: stack.items.length === 1 };
}

export function Editor({ video }: { video: Video }) {
  useStore();
  const jobs = jobsFor(video.id);
  const latest = jobs.length ? jobs[jobs.length - 1] : null;
  const lastDone = [...jobs].reverse().find((j) => j.status === "done") ?? null;

  const original = useFileUrl("original", video.id);
  const hist = useHistory(latest ? effectiveMask(latest) : { regions: [] });
  const mask = hist.current;

  // Detection may finish after the editor opens; adopt its zones until the user edits anything.
  const latestDetected = latest?.detectedMask ? JSON.stringify(latest.detectedMask) : "";
  useEffect(() => {
    if (latest && hist.pristine && latest.detectedMask) hist.reset(effectiveMask(latest));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latestDetected]);

  const [zone, setZone] = useState<Region["kind"]>("erase");
  const [selected, setSelected] = useState<string | null>(null);
  const [mode, setMode] = useState<RemovalMode>("watermark");
  const [autoDetect, setAutoDetect] = useState(false);
  const [view, setView] = useState<"edit" | "result">("edit");
  const [compareId, setCompareId] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);

  const compareJob = jobs.find((j) => j.id === compareId) ?? null;
  const comparePreview = useFileUrl("preview", compareJob?.id, compareJob?.status === "done");
  const pending = jobs.find((j) => j.id === pendingId) ?? null;

  // When a re-process finishes, show it.
  useEffect(() => {
    if (pending?.status === "done") {
      setCompareId(pending.id);
      setView("result");
      setPendingId(null);
      toast(`Saved as version ${jobs.findIndex((j) => j.id === pending.id) + 1}`);
    } else if (pending && (pending.status === "failed" || pending.status === "canceled")) {
      setPendingId(null);
      if (pending.status === "failed") toast(pending.errorMessage ?? "Cleaning failed.", "error");
    }
  }, [pending, jobs]);

  // ---- player ----
  const vid = useRef<HTMLVideoElement>(null);
  const [t, setT] = useState(0);
  const [duration, setDuration] = useState((video.durationMs ?? 0) / 1000);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true);
  const togglePlay = useCallback(() => {
    const v = vid.current;
    if (!v) return;
    if (v.paused) void v.play(); else v.pause();
  }, []);

  // ---- drawing ----
  const stage = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const [draft, setDraft] = useState<Region | null>(null);
  const ratio = video.width && video.height ? video.width / video.height : 16 / 9;

  const point = (e: React.PointerEvent) => {
    const r = stage.current!.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  };

  const updateRegion = (id: string, patch: Partial<Region>, commit: boolean) => {
    const next = { regions: mask.regions.map((r) => (r.id === id ? normalizeRegion({ ...r, ...patch }) : r)) };
    if (commit) hist.push(next); else hist.replace(next);
  };

  const onStageDown = (e: React.PointerEvent) => {
    if (view !== "edit" || e.button !== 0) return;
    stage.current!.setPointerCapture(e.pointerId);
    const p = point(e);
    const target = (e.target as HTMLElement).closest<HTMLElement>("[data-region]");
    const handle = (e.target as HTMLElement).closest<HTMLElement>("[data-handle]");
    if (target) {
      const id = target.dataset.region!;
      const r = mask.regions.find((x) => x.id === id)!;
      setSelected(id);
      hist.push(mask); // snapshot so the whole move is one undo step
      drag.current = handle ? { kind: "resize", id, start: r } : { kind: "move", id, dx: p.x - r.x, dy: p.y - r.y, start: r };
      return;
    }
    setSelected(null);
    const id = uid();
    drag.current = { kind: "draw", x0: p.x, y0: p.y, id };
    setDraft({ id, kind: zone, shape: "rect", x: p.x, y: p.y, w: 0, h: 0, tStartMs: 0, tEndMs: null, track: false, source: "user" });
  };

  const onStageMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const p = point(e);
    if (d.kind === "draw") setDraft((r) => (r ? { ...r, x: d.x0, y: d.y0, w: p.x - d.x0, h: p.y - d.y0 } : r));
    else if (d.kind === "move") updateRegion(d.id, { x: p.x - d.dx, y: p.y - d.dy }, false);
    else updateRegion(d.id, { w: Math.max(MIN_REGION, p.x - d.start.x), h: Math.max(MIN_REGION, p.y - d.start.y) }, false);
  };

  const onStageUp = () => {
    const d = drag.current;
    drag.current = null;
    if (d?.kind === "draw" && draft) {
      if (Math.abs(draft.w) >= MIN_REGION && Math.abs(draft.h) >= MIN_REGION) {
        const r = normalizeRegion(draft);
        hist.push({ regions: [...mask.regions, r] });
        setSelected(r.id);
      }
      setDraft(null);
    }
  };

  const removeRegion = useCallback((id: string) => {
    hist.push({ regions: mask.regions.filter((r) => r.id !== id) });
    setSelected(null);
  }, [hist, mask]);

  const onKey = (e: React.KeyboardEvent) => {
    const tag = (e.target as HTMLElement).tagName;
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === "z") { e.preventDefault(); if (e.shiftKey) hist.redo(); else hist.undo(); return; }
    if (mod) return;
    if (e.key === "e" || e.key === "E") setZone("erase");
    else if (e.key === "k" || e.key === "K") setZone("protect");
    else if (e.key === " " && (e.target as HTMLElement).getAttribute("role") !== "button" && tag !== "BUTTON") { e.preventDefault(); togglePlay(); }
    else if (selected && (e.key === "Delete" || e.key === "Backspace")) { e.preventDefault(); removeRegion(selected); }
    else if (selected && e.key.startsWith("Arrow")) {
      e.preventDefault();
      const r = mask.regions.find((x) => x.id === selected);
      if (!r) return;
      const step = e.shiftKey ? 0.05 : 0.01;
      const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
      const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
      updateRegion(r.id, { x: r.x + dx, y: r.y + dy }, true);
    } else if (e.key === "Escape") setSelected(null);
  };

  const selectedRegion = mask.regions.find((r) => r.id === selected) ?? null;
  const canClean = hasErase(mask) || autoDetect;
  const busy = !!pending && !["done", "failed", "canceled"].includes(pending.status);

  const clean = async () => {
    const r = await createJob(video.id, {
      mask: { regions: mask.regions.map(normalizeRegion) },
      autoDetect: autoDetect && !hasErase(mask),
      parentJobId: latest?.id ?? null,
      mode,
    });
    if (r.ok) setPendingId(r.job.id);
    else if (r.reason === "daily_cap") toast(`No previews left today. They reset in ${r.resetsInHours} h.`, "error");
    else toast("This video isn't ready yet.", "error");
  };

  const regionsShown = draft ? [...mask.regions, normalizeRegion(draft)] : mask.regions;
  const previewEnd = useMemo(() => (duration ? Math.min(1, PREVIEW_MS / 1000 / duration) : 0), [duration]);

  return (
    <div className="mx-auto max-w-page px-4 lg:px-8 py-6" onKeyDown={onKey}>
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <Link href={`/b/${video.batchId}`} className={buttonClass("ghost", "sm")}><ArrowLeft className="size-4" aria-hidden />Back to batch</Link>
        <h1 className="text-lg truncate min-w-0" title={video.filename}>{video.filename}</h1>
        <span className="text-sm text-text-muted tabnums">{formatDuration(video.durationMs)}</span>
      </div>

      <div className="rounded-xl border border-border overflow-hidden grid grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_var(--t-layout-editor-panel-w)]">
        <div className="bg-canvas text-on-canvas on-canvas min-w-0">
          {view === "edit" ? (
            <div role="toolbar" aria-label="Zone tools" className="h-12 px-3 flex items-center gap-2 border-b border-canvas-raised overflow-x-auto">
              <div className="flex rounded-md bg-canvas-raised p-0.5 shrink-0" role="group" aria-label="Shape">
                <button type="button" aria-pressed="true" className="h-8 px-3 rounded-sm bg-accent text-on-accent text-sm inline-flex items-center gap-1"><SquareDashed className="size-4" aria-hidden />Box</button>
                <button type="button" disabled title="Brush comes with the GPU engine" className="h-8 px-3 rounded-sm text-sm inline-flex items-center gap-1 text-canvas-muted opacity-60"><Brush className="size-4" aria-hidden />Brush</button>
              </div>
              <div className="flex rounded-md bg-canvas-raised p-0.5 shrink-0" role="group" aria-label="Zone type">
                <button type="button" aria-pressed={zone === "erase"} onClick={() => setZone("erase")} title="Erase (E)" className={`h-8 px-3 rounded-sm text-sm inline-flex items-center gap-1.5 ${zone === "erase" ? "bg-on-canvas text-canvas" : "hover:bg-canvas"}`}>
                  <span className="size-2.5 rounded-sm bg-mask-erase" aria-hidden />Erase
                </button>
                <button type="button" aria-pressed={zone === "protect"} onClick={() => setZone("protect")} title="Keep (K)" className={`h-8 px-3 rounded-sm text-sm inline-flex items-center gap-1.5 ${zone === "protect" ? "bg-on-canvas text-canvas" : "hover:bg-canvas"}`}>
                  <span className="size-2.5 rounded-sm border border-dashed border-mask-protect hatch" aria-hidden />Keep
                </button>
              </div>
              <IconButton tone="canvas" label="Undo (⌘Z)" onClick={hist.undo} disabled={!hist.canUndo} className="size-8 shrink-0"><Undo2 className="size-4" aria-hidden /></IconButton>
              <IconButton tone="canvas" label="Redo (⌘⇧Z)" onClick={hist.redo} disabled={!hist.canRedo} className="size-8 shrink-0"><Redo2 className="size-4" aria-hidden /></IconButton>
              <Button size="sm" className="ml-auto shrink-0" onClick={clean} disabled={!canClean || busy} loading={busy}>
                {busy ? (pending?.status === "rendering" ? `Cleaning ${pending.progress}%` : pending?.status === "detecting" ? "Finding…" : "Waiting…") : "Clean again"}
              </Button>
            </div>
          ) : (
            <div className="h-12 px-3 flex items-center gap-2 border-b border-canvas-raised">
              <Button size="sm" variant="secondary" onClick={() => setView("edit")}><ArrowLeft className="size-4" aria-hidden />Back to editing</Button>
              <span className="text-sm text-canvas-muted truncate">Version {jobs.findIndex((j) => j.id === compareId) + 1} · first 5 seconds</span>
            </div>
          )}

          {view === "result" && compareJob && original && comparePreview ? (
            <BeforeAfter beforeVideo={original} afterVideo={comparePreview} rounded="rounded-none" limitS={5} />
          ) : (
            <div className="bg-canvas">
              <div
                ref={stage}
                className="relative mx-auto touch-none cursor-crosshair outline-none"
                style={{ aspectRatio: String(ratio), width: `min(100%, calc(70dvh * ${ratio}))` }}
                tabIndex={0}
                aria-label="Video with zones. Drag to draw a zone. Select a zone, then use arrow keys to move it and Delete to remove it."
                onPointerDown={onStageDown} onPointerMove={onStageMove} onPointerUp={onStageUp} onPointerCancel={onStageUp}
              >
                {original && (
                  <video
                    ref={vid} src={original} playsInline muted={muted} preload="auto" className="absolute inset-0 size-full object-fill pointer-events-none"
                    onTimeUpdate={(e) => setT(e.currentTarget.currentTime)}
                    onLoadedMetadata={(e) => Number.isFinite(e.currentTarget.duration) && setDuration(e.currentTarget.duration)}
                    onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}
                  />
                )}
                {regionsShown.map((r) => {
                  const active = t * 1000 >= r.tStartMs && (r.tEndMs == null || t * 1000 <= r.tEndMs);
                  const isSel = r.id === selected;
                  return (
                    <div
                      key={r.id} data-region={r.id}
                      className={`absolute rounded-sm cursor-move ${r.kind === "erase" ? "bg-mask-erase-fill border-2 border-mask-erase" : "hatch border-2 border-dashed border-mask-protect"} ${r.source === "auto" ? "opacity-80" : ""} ${active ? "" : "opacity-35"} ${isSel ? "outline-2 outline-on-canvas outline-offset-1" : ""}`}
                      style={{ left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%` }}
                    >
                      <span className={`absolute ${r.y < 0.08 ? "top-full mt-1" : "-top-6"} left-0 h-5 px-2 rounded-pill bg-chip-on-video text-white text-xs grid place-items-center whitespace-nowrap pointer-events-none`}>
                        {r.source === "auto" ? "Auto" : r.kind === "erase" ? "Erase" : "Keep"}
                      </span>
                      {isSel && <span data-handle className="absolute -right-2 -bottom-2 size-4 bg-white border border-canvas cursor-nwse-resize" aria-hidden />}
                    </div>
                  );
                })}
              </div>
              <div className="h-12 px-3 flex items-center gap-3 bg-canvas-raised">
                <IconButton tone="canvas" label={playing ? "Pause (Space)" : "Play (Space)"} onClick={togglePlay} className="size-8">
                  {playing ? <Pause className="size-4" aria-hidden /> : <Play className="size-4" aria-hidden />}
                </IconButton>
                <span className="font-mono text-xs tabnums text-canvas-muted whitespace-nowrap">{formatClock(t)} / {formatClock(duration)}</span>
                <div className="relative flex-1 min-w-16">
                  <input
                    type="range" min={0} max={duration || 0} step={0.01} value={t} aria-label="Seek"
                    onChange={(e) => { const v = vid.current; if (v) v.currentTime = Number(e.target.value); setT(Number(e.target.value)); }}
                    className="w-full accent-[var(--t-color-on-canvas)]"
                  />
                  {previewEnd > 0 && previewEnd < 1 && (
                    <span className="absolute -top-1 w-0.5 h-5 bg-accent pointer-events-none" style={{ left: `${previewEnd * 100}%` }} title="The free preview ends here" aria-hidden />
                  )}
                </div>
                <IconButton tone="canvas" label={muted ? "Unmute" : "Mute"} onClick={() => setMuted(!muted)} className="size-8">
                  {muted ? <VolumeX className="size-4" aria-hidden /> : <Volume2 className="size-4" aria-hidden />}
                </IconButton>
              </div>
            </div>
          )}
          {busy && pending && (
            <div className="px-3 py-2 bg-canvas-raised border-t border-canvas"><ProgressBar value={pending.status === "rendering" ? pending.progress : null} label="Cleaning the preview" /></div>
          )}
        </div>

        <aside className="bg-surface lg:border-l border-t lg:border-t-0 border-border p-4 space-y-5 text-sm" aria-label="Zones and versions">
          <label className="block">
            <span className="text-xs font-medium text-text-muted">Remove</span>
            <select value={mode} onChange={(e) => setMode(e.target.value as RemovalMode)} className="mt-1 w-full h-10 px-3 rounded-md border border-border-input bg-bg text-base">
              {MODES.map((m) => <option key={m.id} value={m.id} disabled={!m.ready}>{m.label}</option>)}
            </select>
          </label>
          <div className="flex items-center justify-between gap-3">
            <span id="auto-label">Find it automatically</span>
            <Switch checked={autoDetect} onChange={setAutoDetect} label="Find it automatically" />
          </div>
          <div className="flex items-center justify-between gap-3 text-text-muted">
            <span title="Comes with the GPU engine">Follow a moving mark <span className="text-xs">(soon)</span></span>
            <Switch checked={false} onChange={() => {}} label="Follow a moving mark" disabled />
          </div>

          <section aria-labelledby="zones-h">
            <h2 id="zones-h" className="text-xs font-medium text-text-muted mb-2">Zones</h2>
            {mask.regions.length === 0 ? (
              <p className="text-text-muted">No zones yet. Drag over the video to draw an erase box.</p>
            ) : (
              <ul className="space-y-1">
                {mask.regions.map((r) => (
                  <li key={r.id} className={`flex items-center gap-2 h-10 px-2 rounded-md ${r.id === selected ? "bg-surface-raised border border-accent" : "hover:bg-surface-hover"}`}>
                    <button type="button" className="flex items-center gap-2 flex-1 min-w-0 h-full text-left" aria-pressed={r.id === selected} onClick={() => { setSelected(r.id); stage.current?.focus(); }}>
                      <span className={`size-2.5 rounded-sm shrink-0 ${r.kind === "erase" ? "bg-mask-erase" : "border border-dashed border-mask-protect hatch"}`} aria-hidden />
                      <span className="truncate">{describeRegion(r)}</span>
                      <span className="text-xs text-text-muted ml-auto tabnums whitespace-nowrap">{formatClock(r.tStartMs / 1000).slice(0, -3)}–{r.tEndMs == null ? "end" : formatClock(r.tEndMs / 1000).slice(0, -3)}</span>
                    </button>
                    <IconButton label={`Delete ${describeRegion(r)}`} className="size-8" onClick={() => removeRegion(r.id)}><Trash2 className="size-4" aria-hidden /></IconButton>
                  </li>
                ))}
              </ul>
            )}
            {selectedRegion && (
              <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Selected zone timing">
                <Button size="sm" variant="outline" onClick={() => updateRegion(selectedRegion.id, { tStartMs: Math.round(t * 1000) }, true)}>Start here</Button>
                <Button size="sm" variant="outline" onClick={() => updateRegion(selectedRegion.id, { tEndMs: Math.max(selectedRegion.tStartMs, Math.round(t * 1000)) }, true)}>End here</Button>
                <Button size="sm" variant="ghost" onClick={() => updateRegion(selectedRegion.id, { tStartMs: 0, tEndMs: null }, true)}>Whole video</Button>
              </div>
            )}
            {!canClean && <p className="text-xs text-text-muted mt-3">Draw at least one erase box, or turn on &quot;Find it automatically&quot;.</p>}
          </section>

          <section aria-labelledby="versions-h">
            <h2 id="versions-h" className="text-xs font-medium text-text-muted mb-2">Versions</h2>
            {jobs.length === 0 ? <p className="text-text-muted">Nothing cleaned yet.</p> : (
              <ul className="space-y-2">
                {[...jobs].reverse().map((j) => <VersionRow key={j.id} job={j} n={jobs.indexOf(j) + 1} onCompare={() => { setCompareId(j.id); setView("result"); }} onCancel={() => cancelJob(j.id)} />)}
              </ul>
            )}
          </section>

          {lastDone && (
            <div className="flex flex-wrap gap-2 pt-2 border-t border-border">
              <DownloadPreview job={compareJob?.status === "done" ? compareJob : lastDone} filename={video.filename} />
              <Button size="sm" onClick={() => setExportOpen(true)}>Export</Button>
            </div>
          )}
          <p className="text-xs text-text-muted">Shortcuts: E erase, K keep, Space play, arrows move a zone, Delete removes it, ⌘Z undo.</p>
        </aside>
      </div>

      <ExportDialog job={compareJob?.status === "done" ? compareJob : lastDone} video={video} open={exportOpen} onOpenChange={setExportOpen} />
    </div>
  );
}

function VersionRow({ job, n, onCompare, onCancel }: { job: Job; n: number; onCompare: () => void; onCancel: () => void }) {
  const label = job.autoDetect && !job.mask.regions.length ? "auto" : `${job.mask.regions.length} zone${job.mask.regions.length === 1 ? "" : "s"}`;
  return (
    <li className="flex items-center justify-between gap-2">
      <span className="min-w-0">
        <span className="block">Version {n} · {label}</span>
        <span className="block text-xs text-text-muted">{timeAgo(job.createdAt)}</span>
      </span>
      {job.status === "done" ? (
        <button type="button" className="text-accent underline shrink-0" onClick={onCompare}>Compare</button>
      ) : job.status === "failed" ? (
        <StatusBadge tone={job.errorCode === "nothing_found" ? "warning" : "danger"}>{job.errorCode === "nothing_found" ? "Nothing found" : "Failed"}</StatusBadge>
      ) : job.status === "canceled" ? (
        <StatusBadge>Canceled</StatusBadge>
      ) : (
        <button type="button" className="text-xs underline shrink-0" onClick={onCancel}>Cancel</button>
      )}
    </li>
  );
}

function DownloadPreview({ job, filename }: { job: Job; filename: string }) {
  const url = useFileUrl("preview", job.id, job.status === "done");
  if (!url) return null;
  return (
    <a href={url} download={`${baseName(filename)}-cleaned-5s.webm`} className={buttonClass("outline", "sm")}>
      <Download className="size-4" aria-hidden />5 s preview
    </a>
  );
}
