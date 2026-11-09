// Writes a Duration into a MediaRecorder WebM without touching anything but
// the Segment > Info block. Browsers record WebM with no duration (so the
// player can't seek or show the length). The common fix-webm-duration package
// re-serialises every container with a fixed size, which nests all clusters
// inside the first one; Chrome tolerates that but Safari refuses to play it.
// Here the rest of the file stays byte-for-byte as recorded.

const ID_SEGMENT = 0x18538067;
const ID_INFO = 0x1549a966;
const ID_SEEKHEAD = 0x114d9b74;
const ID_CLUSTER = 0x1f43b675;
const ID_TIMECODE_SCALE = 0x2ad7b1;
const ID_DURATION = 0x4489;

type Vint = { value: number; length: number; unknown: boolean };

function readVint(b: Uint8Array, at: number, keepMarker: boolean): Vint | null {
  const first = b[at];
  if (first === undefined || first === 0) return null;
  let length = 1;
  while (length <= 8 && !(first & (0x80 >> (length - 1)))) length++;
  if (length > 8 || at + length > b.length) return null;
  let value = keepMarker ? first : first & (0xff >> length);
  let allOnes = value === 0xff >> length;
  for (let i = 1; i < length; i++) {
    value = value * 256 + b[at + i];
    if (b[at + i] !== 0xff) allOnes = false;
  }
  return { value, length, unknown: !keepMarker && allOnes };
}

function writeSize(n: number): Uint8Array {
  let length = 1;
  while (n >= 2 ** (7 * length) - 1 && length < 8) length++;
  const out = new Uint8Array(length);
  let v = n;
  for (let i = length - 1; i >= 0; i--) {
    out[i] = v % 256;
    v = Math.floor(v / 256);
  }
  out[0] |= 0x80 >> (length - 1);
  return out;
}

function writeId(id: number): Uint8Array {
  const bytes: number[] = [];
  for (let v = id; v > 0; v = Math.floor(v / 256)) bytes.unshift(v % 256);
  return Uint8Array.from(bytes);
}

function element(id: number, body: Uint8Array): Uint8Array {
  const head = writeId(id);
  const size = writeSize(body.length);
  const out = new Uint8Array(head.length + size.length + body.length);
  out.set(head, 0);
  out.set(size, head.length);
  out.set(body, head.length + size.length);
  return out;
}

/** Returns a new blob with the duration set, or the original blob if it can't be patched safely. */
export async function setWebmDuration(blob: Blob, durationMs: number): Promise<Blob> {
  if (!(durationMs > 0)) return blob;
  const head = new Uint8Array(await blob.slice(0, 256 * 1024).arrayBuffer());

  // EBML header
  const ebmlId = readVint(head, 0, true);
  const ebmlSize = ebmlId && readVint(head, ebmlId.length, false);
  if (!ebmlId || !ebmlSize || ebmlSize.unknown) return blob;
  let at = ebmlId.length + ebmlSize.length + ebmlSize.value;

  // Segment
  const segId = readVint(head, at, true);
  if (!segId || segId.value !== ID_SEGMENT) return blob;
  const segSize = readVint(head, at + segId.length, false);
  if (!segSize) return blob;
  const segSizeAt = at + segId.length;
  at = segSizeAt + segSize.length;

  // Find Info among the Segment's first children
  while (at < head.length) {
    const id = readVint(head, at, true);
    const size = id && readVint(head, at + id.length, false);
    if (!id || !size) return blob;
    // A SeekHead stores byte offsets that a size change would break; leave such files alone.
    if (id.value === ID_SEEKHEAD || id.value === ID_CLUSTER) return blob;
    const bodyAt = at + id.length + size.length;
    if (id.value !== ID_INFO) {
      if (size.unknown) return blob;
      at = bodyAt + size.value;
      continue;
    }
    if (size.unknown || bodyAt + size.value > head.length) return blob;

    // Rebuild Info: keep every child except Duration, then append Duration (float64, in timecode units)
    const kept: Uint8Array[] = [];
    let scale = 1_000_000;
    for (let p = bodyAt; p < bodyAt + size.value; ) {
      const cid = readVint(head, p, true);
      const csize = cid && readVint(head, p + cid.length, false);
      if (!cid || !csize || csize.unknown) return blob;
      const end = p + cid.length + csize.length + csize.value;
      if (cid.value === ID_TIMECODE_SCALE) {
        let v = 0;
        for (let i = p + cid.length + csize.length; i < end; i++) v = v * 256 + head[i];
        if (v > 0) scale = v;
      }
      if (cid.value !== ID_DURATION) kept.push(head.slice(p, end));
      p = end;
    }
    const dur = new Uint8Array(8);
    new DataView(dur.buffer).setFloat64(0, (durationMs * 1_000_000) / scale);
    kept.push(element(ID_DURATION, dur));
    const body = new Uint8Array(kept.reduce((n, k) => n + k.length, 0));
    let o = 0;
    for (const k of kept) {
      body.set(k, o);
      o += k.length;
    }
    const info = element(ID_INFO, body);
    const infoEnd = bodyAt + size.value;

    let segHeader = head.slice(0, segSizeAt + segSize.length);
    if (!segSize.unknown) {
      // Known Segment size: grow it by the change in Info's size.
      const newSize = writeSize(segSize.value + info.length - (infoEnd - at));
      if (newSize.length !== segSize.length) return blob;
      segHeader = segHeader.slice();
      segHeader.set(newSize, segSizeAt);
    }
    return new Blob([segHeader, head.slice(segSizeAt + segSize.length, at), info, blob.slice(infoEnd)] as BlobPart[], {
      type: blob.type,
    });
  }
  return blob;
}
