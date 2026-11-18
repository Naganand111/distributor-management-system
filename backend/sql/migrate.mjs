// ===========================================================================
// Database migration runner
// ---------------------------------------------------------------------------
// * Loads configuration from backend/.env via `dotenv/config` (never assumes
//   shell variables are present).
// * Reads ONLY from DB_HOST / DB_PORT / DB_USER / DB_PASSWORD / DB_NAME.
// * Applies the baseline schema (schema.sql) on a fresh database, then every
//   file in sql/migrations/ in numeric order.
// * Correctly parses DELIMITER directives and stored procedures. DELIMITER is
//   a client-side command and is NEVER sent to MySQL.
// * Records every successfully applied file in schema_migrations.
// * Migration files are written idempotently (IF NOT EXISTS / helper procs) so
//   a re-run does not duplicate or corrupt the schema.
//
// Transaction note: MySQL performs an implicit COMMIT before every DDL
// statement, so DDL migrations CANNOT be rolled back transactionally. The
// runner therefore marks a migration as applied only when every statement in
// it succeeds, and treats harmless "already exists" errors as skips.
// ===========================================================================

import "dotenv/config";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import mysql from "mysql2/promise";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(__dirname, "migrations");
const baselineFile = path.join(__dirname, "schema.sql");

const BENIGN_ERRORS = new Set([
  "ER_TABLE_EXISTS_ERROR",
  "ER_DUP_KEYNAME",
  "ER_DUP_FIELDNAME",
  "ER_DUP_ENTRY",
  "ER_CANT_DROP_FIELD_OR_KEY",
]);

function log(msg) {
  console.log(msg);
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value || !String(value).trim()) {
    console.error(`\nConfiguration error: required environment variable ${name} is not set.`);
    console.error("Copy backend/.env.example to backend/.env and fill in your database credentials.\n");
    process.exit(1);
  }
  return String(value).trim();
}

/**
 * Split a SQL script into individual statements.
 *
 * Handles:
 *   - the default `;` delimiter
 *   - `DELIMITER <token>` blocks (e.g. `//`) used around stored procedures
 *   - full-line `--` and `#` comments and `/* ... *\/` block comments
 *   - blank lines
 *
 * `DELIMITER` directives are consumed by the parser and never returned.
 */
function splitSqlStatements(sql) {
  const withoutBlockComments = sql.replace(/\/\*[\s\S]*?\*\//g, "");
  const lines = withoutBlockComments.split(/\r?\n/);
  const statements = [];
  let buffer = "";
  let delimiter = ";";

  const flush = () => {
    const stmt = buffer.trim();
    if (stmt) statements.push(stmt);
    buffer = "";
  };

  for (const rawLine of lines) {
    const line = rawLine.replace(/\r$/, "");
    const trimmed = line.trim();

    // Client-side DELIMITER command (never sent to MySQL).
    const delimMatch = trimmed.match(/^DELIMITER\s+(\S+)\s*$/i);
    if (delimMatch) {
      flush();
      delimiter = delimMatch[1];
      continue;
    }

    // Skip blank lines and whole-line comments.
    if (!trimmed || trimmed.startsWith("--") || trimmed.startsWith("#")) {
      continue;
    }

    buffer += line + "\n";

    const trimmedBuffer = buffer.trimEnd();
    if (trimmedBuffer.endsWith(delimiter)) {
      const stmt = trimmedBuffer.slice(0, trimmedBuffer.length - delimiter.length).trim();
      if (stmt) statements.push(stmt);
      buffer = "";
    }
  }

  flush();
  return statements;
}

// Server-scoped statements that the runner must not forward: the connection is
// already scoped to DB_NAME from the environment.
function isIgnoredStatement(stmt) {
  return /^(CREATE\s+DATABASE|USE)\b/i.test(stmt.trim());
}

async function tableExists(pool, table) {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS count
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [table]
  );
  return Number(rows[0].count) > 0;
}

async function isApplied(pool, filename) {
  const [rows] = await pool.query(
    "SELECT COUNT(*) AS count FROM schema_migrations WHERE filename = ?",
    [filename]
  );
  return Number(rows[0].count) > 0;
}

async function applyScript(pool, label, filePath) {
  log(`  APPLYING ${label}...`);
  const sql = fs.readFileSync(filePath, "utf8");
  const statements = splitSqlStatements(sql);

  let applied = 0;
  let skipped = 0;
  const errors = [];

  for (const stmt of statements) {
    if (isIgnoredStatement(stmt)) continue;
    try {
      await pool.query(stmt);
      applied++;
    } catch (err) {
      const code = err.code || "";
      if (BENIGN_ERRORS.has(code)) {
        skipped++;
      } else {
        errors.push(`${code || "ERROR"}: ${err.message}`);
      }
    }
  }

  if (errors.length > 0) {
    for (const e of errors) console.error(`   ERROR: ${e}`);
    console.error(`   ${label} had ${errors.length} error(s) - NOT marked as applied`);
    return false;
  }

  await pool.query("INSERT INTO schema_migrations (filename) VALUES (?)", [label]);
  log(`   done: ${applied} applied, ${skipped} skipped (already existed)`);
  return true;
}

const pool = await mysql.createPool({
  host: requireEnv("DB_HOST"),
  port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 3306,
  user: requireEnv("DB_USER"),
  password: process.env.DB_PASSWORD ?? "",
  database: requireEnv("DB_NAME"),
  multipleStatements: false,
  waitForConnections: true,
});

await pool.query(`
  CREATE TABLE IF NOT EXISTS schema_migrations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    filename VARCHAR(150) UNIQUE NOT NULL,
    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )
`);

let failed = false;

// ---------------------------------------------------------------------------
// Baseline schema: required for a completely fresh database. Also idempotent
// on existing databases (everything is CREATE TABLE IF NOT EXISTS).
// ---------------------------------------------------------------------------
const baselineLabel = "000_baseline_schema.sql";
if (await isApplied(pool, baselineLabel)) {
  log(`  SKIP ${baselineLabel} (already applied)`);
} else {
  const ok = await applyScript(pool, baselineLabel, baselineFile);
  if (!ok) failed = true;
}

// ---------------------------------------------------------------------------
// Incremental migrations, applied in numeric order.
// ---------------------------------------------------------------------------
if (!failed) {
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => /^\d+_\w+\.sql$/.test(f))
    .sort();

  for (const file of files) {
    if (await isApplied(pool, file)) {
      log(`  SKIP ${file} (already applied)`);
      continue;
    }

    const ok = await applyScript(pool, file, path.join(migrationsDir, file));
    if (!ok) {
      failed = true;
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// Idempotent seed data.
// ---------------------------------------------------------------------------
if (!failed) {
  await pool.query(
    "INSERT IGNORE INTO companies (id, name, code, status) VALUES (1,'Default Company','DEFAULT','active')"
  );
  await pool.query(
    "INSERT IGNORE INTO branches (id, company_id, name, code, status) VALUES (1, 1, 'Head Office', 'HQ', 'active')"
  );
  await pool.query(
    "INSERT IGNORE INTO loyalty_config (id, points_per_100_rupees, redemption_min_points, points_to_rupee, status) VALUES (1, 1, 100, 1, 'active')"
  );
}

await pool.end();

if (failed) {
  console.error("\nMigration failed. schema_migrations was NOT updated for failed files.");
  process.exit(1);
}

log("Migration complete.");
