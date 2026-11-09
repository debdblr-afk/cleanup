# Deploying Cleanup from scratch (free plans)

Every step, in order, exactly as it worked on 2026-11-08 for https://cleanup.dbdd.in. Allow about an hour the first time.

**What you end up with (all free):**

| Part | Service | Free allowance |
| --- | --- | --- |
| Website and API | **Vercel** Hobby | personal, non-commercial use |
| Accounts, database, sign-in emails | **Supabase** Free | 500 MB database; pauses after a week without use |
| Videos and results | **Cloudflare R2** | 10 GB stored, files up to 5 GB, no download fees |
| Your address | your domain's DNS (here BigRock) | one CNAME record |

**How the app behaves once deployed:**
- **The whole site is behind a passcode** (`SITE_PASSCODE`); there are **no logins**. Visitors are anonymous guests; their videos belong to their browser.
- There are no plans or payments. Everyone, guests included, gets: videos up to 30 minutes and 4 GB, 100 previews a day, unlimited full exports up to 4K (never above the source).
- Exports are made in the visitor's browser tab, with the original sound. A 30-minute video takes about 30 minutes with the tab open.
- **Every file is deleted 3 days after upload**, by a daily cleanup job (03:00 UTC, set in `vercel.json`). The job judges by upload time, so changing `retentionDays` in `lib/plans.ts` also applies to videos already uploaded. An optional R2 rule (step 4.8) is the backup.

**The rule throughout:** you create the accounts, sign in, and paste secret keys yourself. Never paste a secret key into chat, a document or a screenshot.

---

## 0. Before you start

- The `cleanup` folder on your Mac, with Node.js 22 (`node -v`). Run `npm install` once in the folder. On a new Mac, get the folder from your private GitHub repo: install `gh` (`brew install gh`), sign in with `gh auth login --web`, then `gh repo clone debdblr-afk/cleanup`.
- Accounts (all free): **Supabase**, **Cloudflare**, **Vercel**. Signing in with GitHub is quickest for Supabase and Vercel.
- Access to your domain's DNS. For dbdd.in that's **BigRock** (`dns1–4.bigrock.in`).
- A password manager or private note, for the keys you copy along the way.

---

## 1. Supabase project (about 5 minutes)

1. Go to **supabase.com/dashboard**. If asked, create an **organization**: type **Personal**, plan **Free - $0/month**.
2. Click **New project**:
   - **Project name:** `cleanup`
   - **Database password:** click **Generate a password**, then **Copy**, and save it. The app doesn't use it, but the Supabase command-line tool does.
   - **Region:** open the list and pick **South Asia (Mumbai) ap-south-1**. Check it really says Mumbai: the list moves while it scrolls.
   - **Security:** leave **Enable Data API** and **Automatically expose new tables** ticked.
   - Click **Create new project**, and wait for Status: **Healthy**.
3. Note the **project ref**: the 20 letters in the address, `supabase.com/dashboard/project/<ref>`. The project URL is `https://<ref>.supabase.co`.

## 2. Database setup (about 3 minutes)

1. On your Mac, in the `cleanup` folder:
   ```bash
   npm run db:hosted-sql
   ```
   This writes `supabase/hosted-setup.sql`: every table, access rule, function and the storage bucket, in one script.
2. Open the file, select all (⌘A) and copy (⌘C).
3. In Supabase, open **SQL Editor → + New query**, paste (⌘V), and click **Run**.
4. Supabase warns about **"Potential issues"**:
   - **"destructive operations":** these are only `drop function` lines that replace older versions of one function. There's no data on a new project.
   - **a table without RLS:** that's the migrations log.

   Click **Run and enable RLS**.
5. You should see **Success. No rows returned.** The project home now shows **Last migration: media_bucket**.

<details><summary>Optional: check it worked (paste in a new query and Run)</summary>

```sql
select 'tables with RLS' as item, count(*)::text as value from pg_tables where schemaname = 'public' and rowsecurity
union all select 'claim_work versions', count(*)::text from pg_proc where proname = 'claim_work'
union all select 'media bucket private', (select (not public)::text from storage.buckets where id = 'media')
union all select 'realtime tables', (select count(*)::text from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public')
union all select 'migrations recorded', (select count(*)::text from supabase_migrations.schema_migrations);
```
Expected: 9, 1, true, 5, 4 (or however many migration files exist).
</details>

Alternative, from Terminal: `npx supabase login`, then `npx supabase link --project-ref <ref>` (asks for the database password), then `npx supabase db push`. Run these in a real Terminal window, in the `cleanup` folder. If `db push` says **"Target: local stack"**, the link didn't happen, so use the SQL Editor route instead.

## 3. Supabase sign-in settings (about 2 minutes)

1. **Authentication → Sign In / Providers**, under **User Signups**:
   - **Allow new users to sign up:** on
   - **Allow manual linking:** **on**
   - **Allow anonymous sign-ins:** **on**. Guests start without an account.
   - **Confirm email:** on

   Click **Save changes**.
2. **Authentication → URL Configuration**:
   - **Site URL:** `https://cleanup.dbdd.in`, then **Save changes**.
   - **Redirect URLs → Add URL:** `https://cleanup.dbdd.in/auth/callback`, then **Save URLs**.
3. Find the keys at **Project Settings → API Keys → View legacy API keys**. You'll paste them into Vercel in step 6:
   - **anon public**: starts `eyJ…`, and is safe in browsers.
   - **service_role secret**: click **Reveal**, then **Copy**. It's a full-access key, so keep it secret.
   - **Don't** click "Disable JWT-based API keys". Legacy keys retire in early 2027; switching to the new `sb_publishable_…` / `sb_secret_…` keys then means changing those two Vercel settings.

## 4. Cloudflare R2 storage (about 5 minutes)

1. Open **dash.cloudflare.com**. Your **Account ID** is the long code in the address, `dash.cloudflare.com/<account-id>/…`.
2. Go to **Storage & databases → R2 Object Storage**. The first time, click **Add R2 subscription to my account**: $0.00 now, charged only beyond the free allowance. Add a card or PayPal if asked.
3. Click **Create bucket**:
   - **Name:** `cleanup-media`
   - **Location:** Automatic
   - **Storage class:** **Standard** (the free allowance covers Standard only)
   - Click **Create bucket**, then check **Public Access: Disabled**.
4. In the bucket, open **Settings → CORS Policy → Add** (or Edit), replace everything with this, and **Save**:
   ```json
   [{"AllowedOrigins": ["https://cleanup.dbdd.in", "https://YOUR-PROJECT.vercel.app"], "AllowedMethods": ["GET", "PUT", "HEAD"], "AllowedHeaders": ["content-type", "range"], "ExposeHeaders": ["ETag", "Content-Length", "Content-Range", "Accept-Ranges"], "MaxAgeSeconds": 3600}]
   ```
   Put your real Vercel address in once you know it (step 7). Without this rule, browsers can't upload or play videos.
5. Go to **R2 → Manage API tokens → Create Account API token**:
   - **Name:** `cleanup-app`
   - **Permissions:** **Object Read & Write**
   - **Specify bucket(s):** **Apply to specific buckets only**, then pick `cleanup-media`
   - **TTL:** Forever. Leave IP filtering empty.
   - Click **Create Account API Token**.
6. Copy the **Access Key ID** and **Secret Access Key** now; they're shown **once**. You don't need the "Token value" or the jurisdiction URL. If you lose them, delete the token and create a new one.
7. Your R2 address is `https://<account-id>.r2.cloudflarestorage.com`. It's on the R2 overview page as **S3 API**.
8. **Optional backup delete rule:** in the bucket, open **Settings → Object Lifecycle Rules → Add**. Name it `delete-after-4-days`, leave the prefix empty (all files), set **Delete objects after 4 days**, and **Save**. The app already deletes files at 3 days; this only catches anything left behind. Keep it one day longer than the app's retention so it never runs ahead of the app's own cleanup (if you change retention, change this rule too).

## 5. Vercel project (about 5 minutes)

1. Create or sign in to your **vercel.com** account (Hobby).
2. In a **real Terminal window**, not a background process, in the `cleanup` folder:
   ```bash
   npx vercel login
   ```
   It shows a link and a code. Open the link, check the code, and click **Allow Access**. Codes expire in a few minutes, so approve right away. If one expires, run the command again.
3. Create the project and connect the folder:
   ```bash
   npx vercel link --yes --project cleanup
   ```
   This adds a `VERCEL_OIDC_TOKEN` line to your local `.env.local`. That's harmless; your other values stay.

`.vercelignore` keeps local secrets, tests and the server worker out of the upload. Its patterns start with `/` on purpose: a bare `worker` would also drop the website's `app/api/worker/` routes. That happened once and left previews stuck on "Waiting".

## 6. Vercel settings: 12 environment variables

**Seven that aren't secret.** You can add these from Terminal; paste each line and replace the `<…>` parts:
```bash
printf '%s' 'https://<ref>.supabase.co' | npx vercel env add NEXT_PUBLIC_SUPABASE_URL production
printf '%s' 'https://cleanup.dbdd.in' | npx vercel env add NEXT_PUBLIC_SITE_URL production
printf '%s' 's3' | npx vercel env add STORAGE_PROVIDER production
printf '%s' 'https://<account-id>.r2.cloudflarestorage.com' | npx vercel env add S3_ENDPOINT production
printf '%s' 'auto' | npx vercel env add S3_REGION production
printf '%s' 'cleanup-media' | npx vercel env add S3_BUCKET production
printf '%s' "$(openssl rand -hex 32)" | npx vercel env add CRON_SECRET production
```

**Five you paste in the dashboard:** go to **vercel.com → cleanup → Settings → Environment Variables → Add Environment Variable**, with Environment **Production**:

| Key | Value from | Type |
| --- | --- | --- |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase **service_role secret** | **Secret** |
| `S3_ACCESS_KEY_ID` | R2 **Access Key ID** | **Secret** |
| `S3_SECRET_ACCESS_KEY` | R2 **Secret Access Key** | **Secret** |
| `SITE_PASSCODE` | the passcode visitors must type | **Secret** |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase **anon public** | **Config** (not Secret) |

- Vercel refuses **Secret** for any `NEXT_PUBLIC_…` name ("Remove the public framework prefix…"), because those values go to browsers by design. Add the anon key separately as **Config**. That's correct: the anon key is public, and the access rules protect the data.
- **Leave unset:** `NEXT_PUBLIC_EXPORT_WORKER` (so exports happen in the browser with sound), `NEXT_PUBLIC_MAX_UPLOAD_MB` (R2 takes up to 5 GB), and the Resend, Google and worker settings.

Check all 12 are there:
```bash
npx vercel env ls production
```

## 7. Deploy and test

```bash
npx vercel deploy --prod --yes
```
After about 2 minutes it prints **Production URL: https://<name>.vercel.app**.

1. Add that address to the R2 CORS policy (step 4.4), next to cleanup.dbdd.in.
2. Open it, enter the **passcode**, then click **No video handy? Try a sample**, and wait for **Preview ready** on the card.
3. If the card stays on **Waiting**, open the browser's developer tools → Network: `/api/worker/claim` must not be a 404 (see Troubleshooting).

## 8. Your domain: cleanup.dbdd.in

1. Attach the domain to the project, then ask Vercel which record it wants:
   ```bash
   npx vercel domains add cleanup.dbdd.in cleanup
   npx vercel domains verify cleanup.dbdd.in
   ```
   Look for `"type": "CNAME", "name": "cleanup", "value": "….vercel-dns-0xx.com."`. Today it is `9c69b23c5db9d688.vercel-dns-017.com`.
2. In **BigRock**, go to **Orders → dbdd.in → Name Servers & DNS → DNS Records → CNAME → Add CNAME Record**:
   - **Domain/sub-domain:** `cleanup` (BigRock adds `.dbdd.in`)
   - **Points to:** the value from step 1, without `https://`
   - **TTL:** the shortest offered
   - Click **SAVE RECORD**.

   Don't change the name servers or your other records (the ProtonMail CNAMEs run your email).
3. Check it from public DNS, which usually takes minutes even though BigRock says 4–6 hours:
   ```bash
   dig +short cleanup.dbdd.in @8.8.8.8
   ```
4. Vercel issues the HTTPS certificate (Let's Encrypt) automatically once it sees the record, usually within about 2 minutes.
5. **"Site can't be reached" on your own computer, but fine on your phone with mobile data:** your router remembered "not found" from before the record existed; dbdd.in lets that last about 10 hours. Fix it with any of:
   - add DNS servers `1.1.1.1` and `8.8.8.8` in **System Settings → Wi-Fi → Details → DNS**, then restart Chrome;
   - restart the router;
   - just wait.

## 9. Final check on the live site

- The **"Enter the passcode"** page comes first; a wrong passcode is refused, the right one opens the site.
- Upload a short video with sound; it reaches **Preview ready**.
- Export at 720p and download it; it plays at full length **with sound**.
- `/pricing` sends you to the home page; on a phone, nothing scrolls sideways.
- The batch page shows **"kept until"** a date 3 days after upload.
- There's no "Log in" button, and `/login` goes to the home page.

---

## Updating the site later

- **Code changes:** in the `cleanup` folder, run `npx vercel deploy --prod --yes`. Run the tests first (`npm test`, and `npm run e2e` with the local stack running).
- **Database changes:** add a new file to `supabase/migrations/`, then run just that file's SQL in the SQL Editor, or use `npx supabase db push` if the CLI is linked. Don't re-run `hosted-setup.sql` on a project that's already set up; it creates tables that already exist.
- **Settings:** change them in Vercel → Settings → Environment Variables, then redeploy. `NEXT_PUBLIC_…` values only take effect after a new deploy.

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| Cards stuck on **Waiting**; `/api/worker/claim` returns 404 | the worker routes weren't uploaded | `.vercelignore` must use `/worker`, not `worker`; redeploy |
| In **Safari**, the first clean works but later cards stay **"Waiting"** | an old version waited forever for Safari's audio permission (BUG-013, fixed 2026-11-09) | Make sure the latest code is deployed, then **reload the page**. A tab that's stuck keeps running the old code until you reload. To test Safari's engine locally: `npx playwright test --project=safari`. |
| In **Safari**, the **"Cleaned"** side of the before/after view is **black** (or a downloaded `.webm` won't open) | an old version wrote the video length in a way Safari can't read (BUG-014, fixed 2026-11-09) | Deploy the latest code and **reload the page**, then clean the video again. Previews made before the fix stay unplayable in Safari but still play in Chrome; they're deleted after the 3-day retention anyway. |
| Upload fails (CORS error in the console) | the site's address isn't in the R2 CORS policy | add the exact `https://…` origin (step 4.4) |
| The sign-in email link opens localhost | Supabase Site URL or redirect not set | step 3.2 |
| Vercel: "Remove the public framework prefix…" | a `NEXT_PUBLIC_` variable set as Secret | add it as **Config** |
| `vercel whoami` says "Logged out" right after logging in | the login ran somewhere else, or the code expired | run `npx vercel login` in a real Terminal and approve within a few minutes |
| `supabase db push` says "Target: local stack" | the folder isn't linked to the hosted project | `npx supabase link --project-ref <ref>`, or use the SQL Editor |
| The site was fine, then sign-in stopped working | the Supabase free project paused after a week idle | Supabase dashboard → **Resume project** |
| `cleanup.dbdd.in` won't open on one computer only | old DNS answer saved on that network | step 8.5 |

## Reference: the current setup (no secrets)

| | |
| --- | --- |
| Live site | https://cleanup.dbdd.in (also https://cleanup-mu.vercel.app) |
| Code | private GitHub repo https://github.com/debdblr-afk/cleanup (branch `main`). Vercel isn't linked to it: deploys go from the Mac with `npx vercel deploy --prod`. After committing, `git push` keeps GitHub current |
| Vercel | account `debdblr-7151`, project `debdblr-7151s-projects/cleanup`, Hobby |
| Supabase | project `cleanup`, ref `oqrqksjbbafhaecrszvj`, South Asia (Mumbai), Free |
| Cloudflare R2 | account `47999b7340e0bb157282dda7fa55d983`, bucket `cleanup-media`, token `cleanup-app` (Object Read & Write, this bucket only) |
| DNS | BigRock: CNAME `cleanup` → `9c69b23c5db9d688.vercel-dns-017.com` |
| HTTPS | Let's Encrypt via Vercel, renews automatically |
| Retention | 3 days (`retentionDays` in `lib/plans.ts`, applies to existing videos too); cleanup job daily at 03:00 UTC |
| Access | passcode gate (`SITE_PASSCODE`, Secret on Vercel); no logins. Change or delete it in Vercel settings, then redeploy |
