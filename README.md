# Cleanup (working name)

Remove your own logos, burned-in captions and stray text from videos you own. This is a clean-room rebuild of the core loop of a video watermark remover. The planning files are in `../replica-watermark/`: recon, architecture, design, build log and `backend.md`.

## Run it locally

Needs Docker running (for the local Supabase stack).

```bash
npm install
npm run db:start          # local Postgres, Auth, Storage, Realtime, Mailpit (ports 553xx)
cp .env.example .env.local  # then fill from: npx supabase status -o env
npm run dev               # or the "cleanup" entry in ../.claude/launch.json (port 5320)
```

- Sign-in emails go to Mailpit: http://127.0.0.1:55324
- Database UI (Studio): http://127.0.0.1:55323

## Deploying

Every step from zero to a live site on free plans (Vercel, Supabase, Cloudflare R2, your domain) is in [DEPLOY.md](DEPLOY.md). [DEPLOY-WITH-AI.md](DEPLOY-WITH-AI.md) is the same, written to paste into any AI chatbot so it guides you step by step.

## Tests

```bash
npm test                  # unit: quota, masks, plans, the fill and the detector
npm run test:api          # end to end against the dev server: every route, access rules with two users, the worker, crons
npm run e2e               # Playwright: every flow in a real browser, with axe, console and 5xx checks (report in e2e/.report)
```

First time only: `npx playwright install chromium`. The test plan and bug reports are in `../replica-watermark/test-plan.md` and `bugs.md`.

## The export worker

Full-length exports render on a server with ffmpeg (MP4, H.264 with the original's audio as AAC), not in the browser:

```bash
npm run worker            # needs WORKER_SECRET and APP_URL in .env.local, same secret as the app
```

- It claims exports over signed HTTP (`/api/worker/server/*`, HMAC with `WORKER_SECRET`), so it holds no database keys.
- Erase boxes become `delogo`, brush strokes become `removelogo` with a mask image, and keep areas are laid back from the original (`worker/plan.mjs`).
- Run as many as you like: each export goes to one worker, and a worker that dies has its export taken over after a minute of silence. Health check: `GET :5399`.
- Leave `NEXT_PUBLIC_EXPORT_WORKER` empty to go back to rendering exports in the tab (WebM, no sound).
- Previews still render in the tab. The GPU model (tracking moving marks, better fills) plugs in here later.

## How it fits together

- **Reads:** row level security plus Supabase Realtime. **Writes:** `app/api/*`, with ownership, plan limits and daily caps checked on the server.
- **Files:** a private bucket reached only through short-lived signed URLs (`lib/server/storage.ts`). Locally, Supabase Storage; online, Cloudflare R2 (`STORAGE_PROVIDER=s3` + `S3_*`). Uploads are a signed PUT either way.
- **Work queue:** `removal_jobs` and `exports`. Previews are claimed by the open tab (`claim_work()`, `lib/engine/`); exports by the server worker (`claim_export_any()`, `worker/`).
- **Plans:** none. Everyone, guests included, gets the Pro limits (`DEFAULT_PLAN` in `lib/plans.ts`). The Stripe code was removed and is in git history.
- **Crons** (`vercel.json`): `/api/cron/expire` hourly, `/api/cron/sweep` every 5 minutes, both behind `CRON_SECRET`.
