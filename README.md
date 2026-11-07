# Cleanup (working name)

Remove your own logos, burned-in captions and stray text from videos you own. This is a clean-room rebuild of the core loop of a video watermark remover. The planning files are in `../replica-watermark/`: recon, architecture, schema, design and build log.

```bash
npm install
npm run dev        # http://localhost:3000, or use the "cleanup" entry in ../.claude/launch.json (port 5320)
npm test           # unit tests for quota, masks, the fill and the detector
npm run tokens     # regenerate app/styles from ../replica-watermark/design/tokens.json
```

## How this preview works

- **No server yet.** Videos, previews and exports live in the browser (IndexedDB). `lib/data/store.ts` has the same operations as the planned API, so `/replica-backend` can swap it out.
- **In-browser engine.** `lib/engine/` detects static marks, fills erase boxes and records the result with MediaRecorder. It stands in for the GPU worker, with the same inputs and outputs.
- **Demo plans.** `/account` switches between Guest, Free, Plus and Pro to try the limits and the paid export. No payments are involved.
- **"Try a sample"** on the home page draws a short clip with two made-up watermarks, so there's always something to clean.
