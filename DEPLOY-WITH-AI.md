# Deploy "Cleanup" from scratch — instructions for an AI assistant

> **How to use this file:** paste all of it into an AI chatbot (ChatGPT, Gemini, Claude, …) and say: "Guide me through this deployment, one step at a time." Have the `cleanup` project folder on your Mac. Everything here was tested on 2026-11-08 and produced the live site https://cleanup.dbdd.in.

---

## PART A — Instructions for the AI

You are guiding a non-expert through deploying a web app. Follow these rules exactly:

1. **One step at a time.** Give one numbered step (or a few tiny ones), then wait for the person to say it's done or to paste what they see. Never dump the whole guide at once.
2. **Verify before moving on.** Each step lists a **Check**. Ask for that result (a screenshot description, a command's output, or a page message) before continuing.
3. **Secrets stay with the person.** The person creates every account, signs in, approves logins, enters payment details if asked, and pastes secret keys **directly into the service's own page**. Never ask them to paste a secret key, password, or token into this chat. If they do, tell them to rotate it (create a new one) and continue.
4. **Use the exact values** in this file (names, regions, settings, commands). Don't improvise alternatives unless a step says so.
5. **When something fails,** look it up in PART D (Troubleshooting) first. Quote the exact error back to the person and give the matching fix.
6. **Explain simply.** One short sentence of "why" per step is enough. Use plain words.
7. **Commands** are run in the macOS **Terminal** app, inside the `cleanup` folder, unless the step says otherwise. Show each command in its own code block.
8. Keep a running **checklist** (PART E) and show progress when asked.

---

## PART B — What is being deployed (context for the AI)

**The app:** "Cleanup" removes the user's own logos, captions and stray text from their videos. Next.js 15 (App Router, TypeScript) web app in the folder `cleanup/`. No GitHub repository is required.

**How it works:**
- **The whole site is behind a passcode** (`SITE_PASSCODE`). Visitors see an "Enter the passcode" page first; the right passcode sets a signed cookie for 30 days. Cron and worker routes stay open (they have their own secrets).
- **There are no logins.** Visitors are anonymous **guests** (Supabase anonymous sign-in, done automatically); their videos belong to that browser.
- Videos upload **straight from the browser to Cloudflare R2** using short-lived signed URLs. The bucket is private.
- Cleaning and exporting happen **in the visitor's browser tab** (canvas + MediaRecorder). Exports keep the **original sound** (WebM with Opus audio). A 30-minute export takes ~30 minutes with the tab open.
- **No plans or payments.** Everyone gets: videos up to 30 min / 4 GB, 100 previews a day, **unlimited exports** up to 4K (never above the source).
- **Every file is deleted 3 days after upload** by a daily cleanup job (Vercel Cron, 03:00 UTC). It judges by upload time, so a retention change also applies to videos already uploaded. A second daily job (03:30 UTC) frees stalled work.

**Services (all free tiers):**

| Part | Service | Free allowance |
| --- | --- | --- |
| Website + API + daily jobs | **Vercel** (Hobby plan) | personal, non-commercial use; cron jobs max once a day |
| Accounts, database, realtime | **Supabase** (Free plan) | 500 MB database; pauses after ~1 week without use |
| Video storage | **Cloudflare R2** | 10 GB stored, 1M writes + 10M reads/month, files up to 5 GB, no download fees |
| Domain | the person's DNS provider (example: **BigRock** for `dbdd.in`) | one CNAME record |

**Key files in `cleanup/`:**
- `supabase/migrations/*.sql` — the database schema (4 files). `npm run db:hosted-sql` combines them into `supabase/hosted-setup.sql` for a new hosted project.
- `vercel.json` — the two daily cron jobs.
- `.vercelignore` — keeps local secrets, tests and the optional server worker out of the upload. **Its patterns start with `/` on purpose** (a bare `worker` would also exclude `app/api/worker/` and break the site).
- `.env.example` — every setting name. `.env.local` is the person's local-only settings file (never uploaded).
- `lib/plans.ts` — limits (`retentionDays: 3`, `exportsPerDay: Infinity`, etc.). To change retention: edit `retentionDays` on the `pro` line, run the tests, redeploy, and adjust the R2 backup rule (Step 4.7) to one day longer.

**The 12 production settings (environment variables) on Vercel:**

| Name | Value | Secret? | Type in Vercel |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<project-ref>.supabase.co` | no | Config |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase **legacy anon public** key (`eyJ…`) | no (public by design) | **Config** (Vercel refuses Secret for `NEXT_PUBLIC_` names) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase **legacy service_role** key (`eyJ…`) | **yes** | Secret |
| `NEXT_PUBLIC_SITE_URL` | `https://<your-domain>` e.g. `https://cleanup.dbdd.in` | no | Config |
| `STORAGE_PROVIDER` | `s3` | no | any |
| `S3_ENDPOINT` | `https://<cloudflare-account-id>.r2.cloudflarestorage.com` | no | any |
| `S3_REGION` | `auto` | no | any |
| `S3_BUCKET` | `cleanup-media` | no | any |
| `S3_ACCESS_KEY_ID` | R2 API token **Access Key ID** | **yes** | Secret |
| `S3_SECRET_ACCESS_KEY` | R2 API token **Secret Access Key** | **yes** | Secret |
| `CRON_SECRET` | random, from `openssl rand -hex 32` | **yes** | Secret |
| `SITE_PASSCODE` | the passcode visitors must type (chosen by the person) | **yes** | Secret |

Step 3 (Supabase sign-in settings) still matters: **anonymous sign-ins must be ON** — every visitor is an anonymous guest behind the scenes.

**Leave unset on Vercel:** `NEXT_PUBLIC_EXPORT_WORKER`, `NEXT_PUBLIC_MAX_UPLOAD_MB`, `WORKER_SECRET`, `APP_URL`, `RESEND_API_KEY`, `EMAIL_FROM`, `ADMIN_EMAIL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`.

---

## PART C — The steps

Replace placeholders in angle brackets: `<project-ref>`, `<cloudflare-account-id>`, `<your-domain>`, `<vercel-url>`. Example domain used below: `cleanup.dbdd.in`.

### Step 0 — Prepare the Mac (5 min)

1. Install **Node.js 22** if needed (nodejs.org, LTS). Check:
   ```bash
   node -v
   ```
   **Check:** prints `v22.x` (v20+ also works).
2. Open Terminal and go to the project folder (adjust the path if different):
   ```bash
   cd ~/Desktop/CRM/cleanup
   ```
3. Install the project's packages (once):
   ```bash
   npm install
   ```
   **Check:** ends without `ERR!` lines.
4. Optional but recommended — confirm the code builds and its tests pass (the browser tests, `npm run e2e`, run in both Chrome's and Safari's engines and need the local database from `npm run db:start`):
   ```bash
   npm test
   ```
   ```bash
   npm run build
   ```
   **Check:** tests "passed"; build says "Compiled successfully".
5. Make sure the person has (or will create, free): a **Supabase** account, a **Cloudflare** account, a **Vercel** account (signing in with GitHub is easiest), and access to their **domain's DNS** settings. A password manager or private note is needed for keys.

### Step 1 — Create the Supabase project (5 min)

1. Go to **https://supabase.com/dashboard** and sign in.
2. If asked to create an **organization**: Type **Personal**, Plan **Free – $0/month** → **Create organization**.
3. **New project**:
   - **Project name:** `cleanup`
   - **Database password:** click **Generate a password** → **Copy** → save it in the password manager (needed only for the optional command-line route).
   - **Region:** open the dropdown and choose **South Asia (Mumbai) ap-south-1** (or the region closest to the users). **Re-check the field after choosing** — the list scrolls and can select a neighbouring region.
   - **Security:** leave **Enable Data API** ✓ and **Automatically expose new tables** ✓. Leave "Enable automatic RLS" unticked.
   - Click **Create new project**.
4. **Check:** the project page shows **Status: Healthy**. Note the **project ref** — the 20 letters in the browser address after `/project/` — and the project URL `https://<project-ref>.supabase.co`.

### Step 2 — Create the database tables (3 min)

1. In Terminal (in `cleanup/`):
   ```bash
   npm run db:hosted-sql
   ```
   **Check:** prints `wrote supabase/hosted-setup.sql (4 migrations, …)`.
2. Open `supabase/hosted-setup.sql` in a text editor (Finder → cleanup → supabase), press **⌘A** then **⌘C**.
3. Supabase → left sidebar **SQL Editor** → **+ New query** → click in the editor → **⌘V**.
4. Click **Run**.
5. A dialog **"Potential issues detected"** appears (it mentions *destructive operations* — only `drop function` lines that replace old function versions — and a table without RLS — the migrations log). Click **Run and enable RLS**.
6. **Check:** the result says **"Success. No rows returned."** The project home page now shows **Last migration: media_bucket**.

Optional verification (new query → paste → Run):
```sql
select 'tables with RLS' as item, count(*)::text as value from pg_tables where schemaname = 'public' and rowsecurity
union all select 'claim_work versions', count(*)::text from pg_proc where proname = 'claim_work'
union all select 'media bucket private', (select (not public)::text from storage.buckets where id = 'media')
union all select 'realtime tables', (select count(*)::text from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public')
union all select 'migrations recorded', (select count(*)::text from supabase_migrations.schema_migrations);
```
**Check:** 9 · 1 · true · 5 · 4.

> Never run `hosted-setup.sql` twice on the same project (tables already exist). For a fresh start, create a new Supabase project.

*Alternative (command line):* `npx supabase login` → `npx supabase link --project-ref <project-ref>` (asks for the database password) → `npx supabase db push`. If it prints **"Target: local stack"**, the link failed — use the SQL Editor method instead.

### Step 3 — Supabase sign-in settings (2 min)

1. **Authentication → Sign In / Providers** → section **User Signups**:
   - **Allow new users to sign up:** ON
   - **Allow manual linking:** **ON**
   - **Allow anonymous sign-ins:** **ON**
   - **Confirm email:** ON
   - Click **Save changes**. **Check:** "Successfully updated settings".
2. **Authentication → URL Configuration**:
   - **Site URL:** `https://<your-domain>` (e.g. `https://cleanup.dbdd.in`) → **Save changes**.
   - **Redirect URLs → Add URL:** `https://<your-domain>/auth/callback` → **Save URLs**.
   - **Check:** "Successfully updated site URL" and the redirect appears in the list.
3. Keys for later (don't copy them into chat): **Project Settings (gear icon) → API Keys → "View legacy API keys"**:
   - **anon** `public` — click **Copy** when needed.
   - **service_role** `secret` — click **Reveal**, then **Copy** when needed. Full-access key.
   - **Do NOT click "Disable JWT-based API keys".** (Legacy keys are retired by Supabase in early 2027; then switch the two Vercel settings to the new `sb_publishable_…`/`sb_secret_…` keys.)

### Step 4 — Cloudflare R2 storage (6 min)

1. Sign in at **https://dash.cloudflare.com**. The **Account ID** is the 32-character code in the address (`dash.cloudflare.com/<account-id>/…`).
2. Left menu **Storage & databases → R2 Object Storage**. First time: click **Add R2 subscription to my account** ($0.00 due; billed only above the free allowance). The person adds a card/PayPal if Cloudflare asks.
   **Check:** R2 overview shows **Create bucket** and an **S3 API** address `https://<account-id>.r2.cloudflarestorage.com`.
3. **Create bucket**: Name `cleanup-media` · Location **Automatic** · Default storage class **Standard** (free tier covers Standard only) → **Create bucket**.
   **Check:** bucket page shows **Public Access: Disabled**.
4. Bucket → **Settings → CORS Policy → Add** (or **Edit**) → select all, delete, paste this **one line**, then **Save**:
   ```json
   [{"AllowedOrigins": ["https://cleanup.dbdd.in"], "AllowedMethods": ["GET", "PUT", "HEAD"], "AllowedHeaders": ["content-type", "range"], "ExposeHeaders": ["ETag", "Content-Length", "Content-Range", "Accept-Ranges"], "MaxAgeSeconds": 3600}]
   ```
   (Replace `https://cleanup.dbdd.in` with `https://<your-domain>`. The Vercel address is added in Step 7.)
   **Check:** "CORS Policy successfully updated", origin listed with GET PUT HEAD.
5. **R2 → Manage API tokens → Create Account API token**:
   - **Token name:** `cleanup-app`
   - **Permissions:** **Object Read & Write**
   - **Specify bucket(s):** **Apply to specific buckets only** → choose `cleanup-media`
   - **TTL:** Forever · IP filtering: leave empty
   - **Create Account API Token**
6. On the next page the person copies **Access Key ID** and **Secret Access Key** into the password manager — **shown only once**. (Token value and jurisdiction URL are not needed.) If lost: delete the token and create a new one.
7. Optional backup delete rule: bucket → **Settings → Object Lifecycle Rules → Add** → name `delete-after-4-days`, prefix empty, **Delete objects after 4 days** → **Save**. (The app deletes at 3 days; one day longer keeps the backup from running first.)

### Step 5 — Vercel login and project (5 min)

1. Create/sign in to a **Vercel** account at https://vercel.com (Hobby plan).
2. In **Terminal** (a real window), in `cleanup/`:
   ```bash
   npx vercel login
   ```
   It prints `Visit https://vercel.com/oauth/device?user_code=XXXX-XXXX`. Open it, check the code matches, click **Allow Access**. **Approve within a few minutes** (codes expire; if so, run the command again).
   **Check:**
   ```bash
   npx vercel whoami
   ```
   prints the Vercel username (not "Logged out").
3. Create the project and link the folder:
   ```bash
   npx vercel link --yes --project cleanup
   ```
   **Check:** prints `Created <team>/cleanup` and "Detected Next.js". (It also appends a `VERCEL_OIDC_TOKEN` line to `.env.local` — harmless.)

### Step 6 — Vercel settings (8 min)

1. Add the 7 non-secret/generated settings from Terminal. Edit the `<…>` parts first, then run each line:
   ```bash
   printf '%s' 'https://<project-ref>.supabase.co' | npx vercel env add NEXT_PUBLIC_SUPABASE_URL production
   ```
   ```bash
   printf '%s' 'https://<your-domain>' | npx vercel env add NEXT_PUBLIC_SITE_URL production
   ```
   ```bash
   printf '%s' 's3' | npx vercel env add STORAGE_PROVIDER production
   ```
   ```bash
   printf '%s' 'https://<cloudflare-account-id>.r2.cloudflarestorage.com' | npx vercel env add S3_ENDPOINT production
   ```
   ```bash
   printf '%s' 'auto' | npx vercel env add S3_REGION production
   ```
   ```bash
   printf '%s' 'cleanup-media' | npx vercel env add S3_BUCKET production
   ```
   ```bash
   printf '%s' "$(openssl rand -hex 32)" | npx vercel env add CRON_SECRET production
   ```
   **Check:** each prints `✓ Added`.
2. Add the 4 secrets in the browser: **vercel.com → project cleanup → Settings → Environment Variables → Add Environment Variable**. Type **Secret**, Environments **Production**. Use **+ Add new variable** to add all three, then **Save** once:
   - `SUPABASE_SERVICE_ROLE_KEY` = Supabase service_role key
   - `S3_ACCESS_KEY_ID` = R2 Access Key ID
   - `S3_SECRET_ACCESS_KEY` = R2 Secret Access Key
   - `SITE_PASSCODE` = the passcode visitors will type (the person types it here themselves)
3. Add the anon key **separately**: **Add Environment Variable** → Type **Config** (not Secret) → Key `NEXT_PUBLIC_SUPABASE_ANON_KEY` → Value = Supabase anon key → Production → **Save**.
   (If you try it as Secret, Vercel shows "Remove the public framework prefix…" and blocks the whole form.)
4. **Check:**
   ```bash
   npx vercel env ls production
   ```
   lists **12** names: CRON_SECRET, NEXT_PUBLIC_SITE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, NEXT_PUBLIC_SUPABASE_URL, S3_ACCESS_KEY_ID, S3_BUCKET, S3_ENDPOINT, S3_REGION, S3_SECRET_ACCESS_KEY, SITE_PASSCODE, STORAGE_PROVIDER, SUPABASE_SERVICE_ROLE_KEY.

### Step 7 — Deploy and first test (5 min)

1. Deploy:
   ```bash
   npx vercel deploy --prod --yes
   ```
   **Check:** ends with `Production URL: https://<vercel-url>` (e.g. `https://cleanup-xx.vercel.app`).
2. Add that address to the R2 CORS policy (Step 4.4) so testing works before the domain is ready:
   ```json
   [{"AllowedOrigins": ["https://<your-domain>", "https://<vercel-url>"], "AllowedMethods": ["GET", "PUT", "HEAD"], "AllowedHeaders": ["content-type", "range"], "ExposeHeaders": ["ETag", "Content-Length", "Content-Range", "Accept-Ranges"], "MaxAgeSeconds": 3600}]
   ```
3. Open `https://<vercel-url>` → the **"Enter the passcode"** page appears → type the passcode → **Enter** → click **"No video handy? Try a sample"**.
   **Check:** a card appears (thumbnail, "0:06 · 720p · 2 MB"), shows "Waiting" briefly, then **"Preview ready"** with a before/after slider within ~30 seconds.
4. If it stays on "Waiting": see PART D, first row.

### Step 8 — Connect the domain (10 min + DNS time)

1. Attach the domain and get the exact record:
   ```bash
   npx vercel domains add <your-domain> cleanup
   ```
   ```bash
   npx vercel domains verify <your-domain>
   ```
   **Check:** output includes `"type": "CNAME", "name": "<subdomain>", "value": "<something>.vercel-dns-0xx.com."` and `"verified": true`. Note the value. (If verify asks for a TXT ownership record, add that too.)
2. Add the CNAME at the DNS provider. For **BigRock**: My Account → **Orders → `dbdd.in`** → **Name Servers & DNS → DNS Records** → tab **CNAME** → **Add CNAME Record**:
   - **Domain/Sub-domain:** `cleanup` (just the first part; BigRock adds `.dbdd.in`)
   - **Points to (Sub-domain/Fully qualified domain):** the value from step 1, without `https://` (add a trailing `.` only if BigRock rejects it)
   - **TTL:** the shortest offered
   - **SAVE RECORD**
   Do **not** change Name Servers or other records (e.g. existing email/ProtonMail records).
3. Check public DNS (usually minutes, even if the provider says 4–6 hours):
   ```bash
   dig +short <your-domain> @8.8.8.8
   ```
   **Check:** prints the `….vercel-dns-0xx.com.` value and IP addresses.
4. HTTPS: Vercel issues a Let's Encrypt certificate automatically within a few minutes after DNS is seen.
   ```bash
   curl -sI https://<your-domain> | head -1
   ```
   **Check:** `HTTP/2 200`.
5. If the site opens on a phone (mobile data) but **not on the person's computer**: that network cached "doesn't exist" from before the record was added (can last hours). Fix: add DNS servers `1.1.1.1` and `8.8.8.8` in **System Settings → Wi-Fi → Details… → DNS**, restart the browser — or restart the router — or wait. Optionally flush the Mac cache: `sudo dscacheutil -flushcache; sudo killall -HUP mDNSResponder`.

### Step 9 — Final live check (5 min)

On `https://<your-domain>`:
0. The **"Enter the passcode"** page appears first; a wrong passcode says "That passcode isn't right."; the right one opens the site.
1. Tick the rights box, upload a short video **with sound** → **Preview ready**.
2. Card → **Export** → dialog says **"Unlimited exports."** → **Export 720p** (keep the tab open) → **Download**. **Check:** the file plays at full length **with sound**.
3. Batch page shows **"kept until"** a date **3 days** after upload.
4. `https://<your-domain>/pricing` redirects to the home page (no plans).
5. On a phone: the page fits the screen, nothing scrolls sideways.
6. There is no "Log in" button, and `/login` goes to the home page (logins are switched off).

**Deployment complete.**

---

## PART D — Troubleshooting

| Symptom / error | Cause | Fix |
| --- | --- | --- |
| Cards stay **"Waiting"**; browser Network tab shows `/api/worker/claim` → **404** | worker routes missing from upload | `.vercelignore` must contain `/worker` (with leading slash), not `worker`. Fix and redeploy. |
| In **Safari**, the first clean works but later cards stay **"Waiting"** | an old version waited forever for Safari's audio permission (BUG-013, fixed 2026-11-09) | Make sure the latest code is deployed, then **reload the page**. A tab that's stuck keeps running the old code until you reload. To test Safari's engine locally: `npx playwright test --project=safari`. |
| Upload fails; console shows a **CORS** error | site origin not in R2 CORS | Add the exact `https://…` origin to the R2 CORS policy (Step 4.4 / 7.2). |
| Sign-in email link opens **localhost** or is rejected | Supabase Site URL / Redirect URL not set | Step 3.2. |
| Vercel: **"Remove the public framework prefix to keep this value private"** | a `NEXT_PUBLIC_` variable added as Secret | Remove that row, save the others, add it as **Config**. |
| `vercel whoami` → **"Logged out"** after "logging in" | login code expired, or login done elsewhere | Run `npx vercel login` again in Terminal and click **Allow Access** within a few minutes. |
| Vercel login: **`expired_token`** | approval came too late | Run `npx vercel login` again; approve immediately. |
| `supabase db push` → **"Target: local stack"** / Docker errors | folder not linked to hosted project | Use the SQL Editor method (Step 2), or `npx supabase link --project-ref <ref>` first. |
| `supabase` commands → **"Access token not provided"** | CLI not logged in | `npx supabase login` (press Enter, approve in browser). Or use the SQL Editor method. |
| SQL Editor shows **"Potential issues detected"** | normal safety prompt | Click **Run and enable RLS** (Step 2.5). |
| SQL error **"relation already exists"** | setup script run twice | The project is already set up; don't re-run. For a clean start, make a new Supabase project. |
| Site worked, then sign-in/upload fails after a quiet week | Supabase free project **paused** | Supabase dashboard → project → **Resume**. |
| `<your-domain>` doesn't open on one computer only | cached DNS on that network | Step 8.5. |
| `dig @8.8.8.8` shows nothing after an hour | CNAME not saved, or saved on wrong domain/host | Re-check Step 8.2 (host = just the subdomain, value without `https://`). |
| R2 says token/permission denied on upload | token not scoped to `cleanup-media` or wrong keys pasted | Create a new R2 token (Step 4.5), update both S3 keys in Vercel, redeploy. |
| Changes to settings don't appear on the site | `NEXT_PUBLIC_` values are baked in at build | Redeploy: `npx vercel deploy --prod --yes`. |
| Passcode page keeps coming back after entering | browser blocks cookies, or the passcode setting was changed | Allow cookies for the site; after changing `SITE_PASSCODE`, everyone enters the new one once. |
| Want to change or remove the passcode | — | Vercel → Settings → Environment Variables → edit or delete `SITE_PASSCODE` → redeploy. Deleting it opens the site to everyone. |
| Old wording/page after deploy for a few seconds | new version still switching in | Wait ~30 s and reload. |

**Updating the site later:** in `cleanup/`, run `npm test`, then `npx vercel deploy --prod --yes`. Database changes: add a new file in `supabase/migrations/` and run **only that file's SQL** in the SQL Editor.

---

## PART E — Checklist (AI: tick these as you go)

- [ ] 0 Node 22, `npm install`, (tests and build pass)
- [ ] 1 Supabase project `cleanup` (Free, chosen region) — Healthy; project ref noted
- [ ] 2 Database created via SQL Editor — "Success"; Last migration `media_bucket`
- [ ] 3 Sign-in: anonymous ON, manual linking ON, confirm email ON; Site URL + redirect set
- [ ] 4 R2: subscription added; bucket `cleanup-media` (private, Standard); CORS saved; token `cleanup-app` created; keys saved by the person; (optional 8-day rule)
- [ ] 5 Vercel: logged in (`whoami` OK); project `cleanup` linked
- [ ] 6 12 settings present (`vercel env ls production`), including SITE_PASSCODE
- [ ] 7 Deployed; `<vercel-url>` added to CORS; sample reaches "Preview ready"
- [ ] 8 Domain added; CNAME at DNS provider; public DNS shows it; HTTPS 200
- [ ] 9 Live check: passcode page first, upload, preview, export with sound, "kept until" = +3 days, `/pricing` and `/login` → home, phone layout OK

---

## Appendix — The current live setup (reference only, no secrets)

| | |
| --- | --- |
| Live site | https://cleanup.dbdd.in (also https://cleanup-mu.vercel.app) |
| Vercel | account `debdblr-7151`, project `debdblr-7151s-projects/cleanup`, Hobby |
| Supabase | project `cleanup`, ref `oqrqksjbbafhaecrszvj`, South Asia (Mumbai), Free |
| Cloudflare R2 | account `47999b7340e0bb157282dda7fa55d983`, bucket `cleanup-media`, token `cleanup-app` (Object Read & Write, this bucket only); CORS origins: cleanup.dbdd.in, cleanup-mu.vercel.app |
| DNS | BigRock: CNAME `cleanup` → `9c69b23c5db9d688.vercel-dns-017.com` |
| HTTPS | Let's Encrypt via Vercel, auto-renews |
| Retention | 3 days (by upload time); cleanup job daily 03:00 UTC (`vercel.json`) |
| Access | passcode gate (`SITE_PASSCODE`, Secret on Vercel); no logins |
