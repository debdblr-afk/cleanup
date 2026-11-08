// Builds one SQL script that sets up a NEW hosted Supabase project: every migration in
// supabase/migrations/, in order, inside one transaction, plus the record the Supabase CLI
// keeps of applied migrations (so a later `supabase db push` won't run them again).
//
//   npm run db:hosted-sql            -> supabase/hosted-setup.sql (git-ignored)
//
// Paste the file into Supabase -> SQL Editor -> Run. See DEPLOY.md, step 2.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = path.join(path.dirname(new URL(import.meta.url).pathname), "..");
const dir = path.join(root, "supabase/migrations");
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
const out = ["-- Cleanup: full database setup for a NEW Supabase project. Paste into SQL Editor and Run once.",
  `-- Built from ${files.length} files in supabase/migrations/ by npm run db:hosted-sql.`, "begin;"];
for (const f of files) out.push("", `-- ==== ${f} ====`, readFileSync(path.join(dir, f), "utf8").trim());
out.push("", "-- ==== record the migrations as applied (what `supabase db push` keeps) ====",
  "create schema if not exists supabase_migrations;",
  "create table if not exists supabase_migrations.schema_migrations (version text primary key, statements text[], name text);");
for (const f of files) {
  const [version, ...rest] = f.replace(/\.sql$/, "").split("_");
  out.push(`insert into supabase_migrations.schema_migrations (version, name) values ('${version}', '${rest.join("_")}') on conflict (version) do nothing;`);
}
out.push("commit;", "");
const target = path.join(root, "supabase/hosted-setup.sql");
writeFileSync(target, out.join("\n"));
console.log(`wrote supabase/hosted-setup.sql (${files.length} migrations, ${out.join("\n").length} characters)`);
