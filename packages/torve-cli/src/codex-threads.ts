import { existsSync, readdirSync } from 'node:fs';
import { copyFile, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  codexDirPath,
  codexMigratedThreadsPath,
  codexSafetyBackupDir,
  legacyCodexMigratedThreadsPath,
} from './state.js';

type SqliteStatement = {
  all: (...params: unknown[]) => unknown[];
  run: (...params: unknown[]) => unknown;
};

type SqliteDb = {
  prepare: (sql: string) => SqliteStatement;
  exec?: (sql: string) => unknown;
  close: () => void;
};

type ThreadRow = {
  id: string;
  model_provider: string;
  rollout_path?: string | null;
};

type TableInfoRow = {
  name?: string;
};

export type CodexThreadMigrationOptions = {
  dbPath?: string;
  codexDir?: string;
  manifestPath?: string;
  safetyBackupDir?: string;
};

function discoverCodexStateDbPaths(codexDir = codexDirPath()): string[] {
  if (!existsSync(codexDir)) return [];
  try {
    return readdirSync(codexDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /^state_.*\.sqlite$/i.test(entry.name))
      .map((entry) => path.join(codexDir, entry.name))
      .sort((a, b) => path.basename(a).localeCompare(path.basename(b), undefined, { numeric: true }));
  } catch {
    return [];
  }
}

async function backupCodexSqliteSafety(dbPath: string, safetyDir: string): Promise<void> {
  await mkdir(safetyDir, { recursive: true });
  const baseName = path.basename(dbPath);
  await copyFile(dbPath, path.join(safetyDir, baseName));
  for (const suffix of ['-wal', '-shm'] as const) {
    const srcSidecar = `${dbPath}${suffix}`;
    const dstSidecar = path.join(safetyDir, `${baseName}${suffix}`);
    if (existsSync(srcSidecar)) {
      await copyFile(srcSidecar, dstSidecar);
    } else if (existsSync(dstSidecar)) {
      await unlink(dstSidecar).catch(() => {});
    }
  }
}

async function openSqlite(dbPath: string): Promise<SqliteDb | null> {
  try {
    const mod = (await import('node:sqlite' as string)) as {
      DatabaseSync?: new (path: string) => SqliteDb;
    };
    if (typeof mod.DatabaseSync === 'function') {
      return new mod.DatabaseSync(dbPath);
    }
  } catch {
    // SQLite binding unavailable in this runtime.
  }
  return null;
}

function runSql(db: SqliteDb, sql: string): void {
  if (typeof db.exec === 'function') {
    db.exec(sql);
  } else {
    db.prepare(sql).run();
  }
}

async function readManifest(manifestPath: string): Promise<Record<string, string>> {
  try {
    const raw = JSON.parse(await readFile(manifestPath, 'utf8')) as unknown;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(raw)) {
      if (typeof key === 'string' && typeof value === 'string' && value.trim().length > 0) {
        result[key] = value;
      }
    }
    return result;
  } catch {
    return {};
  }
}

async function writeManifest(manifestPath: string, manifest: Record<string, string>): Promise<void> {
  await mkdir(path.dirname(manifestPath), { recursive: true });
  const tempPath = `${manifestPath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  await rename(tempPath, manifestPath);
}

function normalizeRolloutPath(rawPath: string): string {
  if (rawPath.startsWith('\\\\?\\UNC\\')) return `\\\\${rawPath.slice(8)}`;
  if (rawPath.startsWith('\\\\?\\')) return rawPath.slice(4);
  return rawPath;
}

async function patchRolloutSessionMeta(rawPath: string, targetProvider: string): Promise<void> {
  try {
    const filePath = normalizeRolloutPath(rawPath);
    if (!existsSync(filePath)) return;
    const content = await readFile(filePath, 'utf8');
    const lineEnding = content.includes('\r\n') ? '\r\n' : '\n';
    const lines = content.split(/\r?\n/);
    let updated = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line) as Record<string, unknown>;
        if (entry['type'] === 'session_meta' && entry['payload'] && typeof entry['payload'] === 'object') {
          const payload = entry['payload'] as Record<string, unknown>;
          if (typeof payload['model_provider'] === 'string' && payload['model_provider'] !== targetProvider) {
            payload['model_provider'] = targetProvider;
            lines[i] = JSON.stringify(entry);
            updated = true;
          }
          break;
        }
      } catch {
        // Ignore malformed JSONL lines.
      }
    }

    if (updated) {
      const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
      await writeFile(tempPath, lines.join(lineEnding), 'utf8');
      await rename(tempPath, filePath);
    }
  } catch {
    // Best-effort.
  }
}

export async function migrateCodexThreadsToTorve(
  opts: CodexThreadMigrationOptions = {},
): Promise<{ migratedCount: number }> {
  const dbPaths = opts.dbPath
    ? (existsSync(opts.dbPath) ? [opts.dbPath] : [])
    : discoverCodexStateDbPaths(opts.codexDir ?? codexDirPath());
  const manifestPath = opts.manifestPath ?? codexMigratedThreadsPath();
  const safetyDir = opts.safetyBackupDir ?? codexSafetyBackupDir();

  if (dbPaths.length === 0) return { migratedCount: 0 };

  let totalMigrated = 0;
  const rollouts: string[] = [];

  for (const dbPath of dbPaths) {
    await backupCodexSqliteSafety(dbPath, safetyDir);
    let db: SqliteDb | null = null;
    try {
      db = await openSqlite(dbPath);
      if (!db) continue;
      const columns = db.prepare('PRAGMA table_info(threads)').all() as TableInfoRow[];
      if (!columns.some((col) => col.name === 'id') || !columns.some((col) => col.name === 'model_provider')) continue;
      const hasRolloutPath = columns.some((col) => col.name === 'rollout_path');
      const selectCols = hasRolloutPath ? 'id, model_provider, rollout_path' : 'id, model_provider';

      let rows: ThreadRow[] = [];
      let inTx = false;
      try {
        runSql(db, 'BEGIN IMMEDIATE');
        inTx = true;
        rows = db
          .prepare(
            `SELECT ${selectCols} FROM threads WHERE model_provider IS NOT NULL AND TRIM(model_provider) != '' AND model_provider != 'torve'`,
          )
          .all() as ThreadRow[];
        if (rows.length > 0) {
          const existingManifest = await readManifest(manifestPath);
          const nextManifest: Record<string, string> = { ...existingManifest };
          for (const row of rows) {
            if (row.id && row.model_provider && !(row.id in nextManifest)) {
              nextManifest[row.id] = row.model_provider;
            }
          }
          await writeManifest(manifestPath, nextManifest);
          const stmt = db.prepare("UPDATE threads SET model_provider = 'torve' WHERE id = ?");
          for (const row of rows) {
            if (row.id) stmt.run(row.id);
          }
        }
        runSql(db, 'COMMIT');
        inTx = false;
      } catch (err) {
        if (inTx) {
          try { runSql(db, 'ROLLBACK'); } catch {}
        }
        throw err;
      }

      totalMigrated += rows.length;
      for (const row of rows) {
        if (typeof row.rollout_path === 'string' && row.rollout_path.trim().length > 0) {
          rollouts.push(row.rollout_path);
        }
      }
    } catch {
      return { migratedCount: totalMigrated };
    } finally {
      try { db?.close(); } catch {}
    }
  }

  for (const r of rollouts) {
    await patchRolloutSessionMeta(r, 'torve');
  }

  return { migratedCount: totalMigrated };
}

export async function restoreCodexThreadsFromTorve(
  opts: CodexThreadMigrationOptions = {},
): Promise<{ restoredCount: number }> {
  const dbPaths = opts.dbPath
    ? (existsSync(opts.dbPath) ? [opts.dbPath] : [])
    : discoverCodexStateDbPaths(opts.codexDir ?? codexDirPath());
  const manifestPath = opts.manifestPath ?? codexMigratedThreadsPath();
  const safetyDir = opts.safetyBackupDir ?? codexSafetyBackupDir();
  const usingDefault = !opts.manifestPath || manifestPath === codexMigratedThreadsPath();

  const manifest = await readManifest(manifestPath);
  const legacy = usingDefault ? await readManifest(legacyCodexMigratedThreadsPath()) : {};
  const merged = { ...legacy, ...manifest };
  const entries = Object.entries(merged);

  if (entries.length === 0) {
    await unlink(manifestPath).catch(() => {});
    if (usingDefault) await unlink(legacyCodexMigratedThreadsPath()).catch(() => {});
    return { restoredCount: 0 };
  }

  let restoredCount = 0;
  const rollouts: Array<{ rolloutPath: string; originalProvider: string }> = [];

  for (const dbPath of dbPaths) {
    await backupCodexSqliteSafety(dbPath, safetyDir);
    let db: SqliteDb | null = null;
    try {
      db = await openSqlite(dbPath);
      if (!db) continue;
      const columns = db.prepare('PRAGMA table_info(threads)').all() as TableInfoRow[];
      if (!columns.some((col) => col.name === 'id') || !columns.some((col) => col.name === 'model_provider')) continue;
      const hasRolloutPath = columns.some((col) => col.name === 'rollout_path');
      const selectRolloutStmt = hasRolloutPath
        ? db.prepare("SELECT rollout_path FROM threads WHERE id = ? AND model_provider = 'torve'")
        : null;
      const stmt = db.prepare("UPDATE threads SET model_provider = ? WHERE id = ? AND model_provider = 'torve'");

      let inTx = false;
      try {
        runSql(db, 'BEGIN IMMEDIATE');
        inTx = true;
        for (const [threadId, originalProvider] of entries) {
          if (selectRolloutStmt) {
            const matches = selectRolloutStmt.all(threadId) as Array<{ rollout_path?: string | null }>;
            for (const row of matches) {
              if (typeof row.rollout_path === 'string' && row.rollout_path.trim().length > 0) {
                rollouts.push({ rolloutPath: row.rollout_path, originalProvider });
              }
            }
          }
          const result = stmt.run(originalProvider, threadId) as { changes?: number | bigint } | undefined;
          if (result && result.changes !== undefined) {
            restoredCount += Number(result.changes);
          }
        }
        runSql(db, 'COMMIT');
        inTx = false;
      } catch (err) {
        if (inTx) {
          try { runSql(db, 'ROLLBACK'); } catch {}
        }
        throw err;
      }
    } catch {
      // Never crash disconnect.
    } finally {
      try { db?.close(); } catch {}
    }
  }

  for (const job of rollouts) {
    await patchRolloutSessionMeta(job.rolloutPath, job.originalProvider);
  }

  await unlink(manifestPath).catch(() => {});
  if (usingDefault) await unlink(legacyCodexMigratedThreadsPath()).catch(() => {});
  return { restoredCount };
}
