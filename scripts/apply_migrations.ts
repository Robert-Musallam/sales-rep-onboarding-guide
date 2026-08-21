/**
 * Applies pending supabase/migrations/*.sql to the remote project.
 *
 * Why not `supabase db push`: the CLI needs a linked project (or the database
 * password) and neither is available on the mac mini, so migration files were
 * silently piling up unapplied — 20260812150000_sms_copy_to.sql sat in the repo
 * for nine days while the setting it seeds was missing in production. This uses
 * the Management API with the SUPABASE_ACCESS_TOKEN already in .env.local, and
 * records every applied file in supabase_migrations.schema_migrations — the same
 * table the CLI uses, so switching back to `db push` later stays consistent.
 *
 *   npm run migrate:status   list applied / pending
 *   npm run migrate          apply every pending file, oldest first
 *
 * Each file runs as a single multi-statement query, i.e. one implicit
 * transaction: a file either lands whole or not at all. A failure stops the run
 * so later migrations never apply out of order.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { config } from "dotenv";

config({ path: path.join(__dirname, "..", ".env.local") });

const DIR = path.join(__dirname, "..", "supabase", "migrations");
const FILE_RE = /^(\d{14})_(.+)\.sql$/;

function projectRef(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const m = url.match(/^https:\/\/([a-z0-9]+)\.supabase\.co/);
  if (!m) throw new Error(`cannot derive project ref from NEXT_PUBLIC_SUPABASE_URL=${url || "(unset)"}`);
  return m[1];
}

async function query<T = unknown>(sql: string): Promise<T> {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token) throw new Error("SUPABASE_ACCESS_TOKEN missing from .env.local");
  const res = await fetch(`https://api.supabase.com/v1/projects/${projectRef()}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Management API ${res.status}: ${text}`);
  return JSON.parse(text) as T;
}

const quote = (s: string) => `'${s.replace(/'/g, "''")}'`;

function localMigrations(): Array<{ version: string; name: string; file: string }> {
  return readdirSync(DIR)
    .map((file) => ({ file, m: FILE_RE.exec(file) }))
    .filter((x): x is { file: string; m: RegExpExecArray } => x.m !== null)
    .map(({ file, m }) => ({ version: m[1], name: m[2], file }))
    .sort((a, b) => a.version.localeCompare(b.version));
}

async function appliedVersions(): Promise<Set<string>> {
  const rows = await query<Array<{ version: string }>>(
    "select version from supabase_migrations.schema_migrations order by version",
  );
  return new Set(rows.map((r) => r.version));
}

async function record(version: string, name: string, sql: string): Promise<void> {
  // `statements` is text[] and not null on the CLI's table; store the file as a
  // single element rather than trying to re-split it.
  await query(
    `insert into supabase_migrations.schema_migrations (version, name, statements)
     values (${quote(version)}, ${quote(name)}, array[${quote(sql)}])
     on conflict (version) do nothing`,
  );
}

async function main() {
  const dryRun = process.argv.includes("--dry-run") || process.argv.includes("--status");
  const applied = await appliedVersions();
  const all = localMigrations();
  const pending = all.filter((m) => !applied.has(m.version));

  for (const m of all) console.log(`  ${applied.has(m.version) ? "applied" : "PENDING"}  ${m.file}`);
  const orphans = [...applied].filter((v) => !all.some((m) => m.version === v));
  if (orphans.length) console.log(`  note: applied but missing locally: ${orphans.join(", ")}`);

  if (!pending.length) return console.log("\nnothing to apply.");
  if (dryRun) return console.log(`\n${pending.length} pending (dry run, nothing applied).`);

  console.log("");
  for (const m of pending) {
    const sql = readFileSync(path.join(DIR, m.file), "utf8");
    process.stdout.write(`applying ${m.file} ... `);
    try {
      await query(sql);
      await record(m.version, m.name, sql);
      console.log("ok");
    } catch (e) {
      console.log("FAILED");
      console.error(`  ${e instanceof Error ? e.message : String(e)}`);
      console.error("  stopped — later migrations were not applied.");
      process.exit(1);
    }
  }
  console.log(`\n${pending.length} migration(s) applied.`);
}

main().then(() => process.exit(0));
