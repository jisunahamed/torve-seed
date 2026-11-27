import { execFile } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { copyFile, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { stopAppIfRunning } from './app-lifecycle.js';

const execFileAsync = promisify(execFile);

export const CODEX_DIR = path.join(homedir(), '.codex');
export const CODEX_STATE_DB_PATH = path.join(CODEX_DIR, 'state_5.sqlite');
export const CODEX_SAFETY_BACKUP_DIR = path.join(homedir(), '.torve', 'backups', 'codex', 'sqlite-safety');
export const CODEX_MIGRATED_THREADS_PATH = path.join(homedir(), '.torve', 'backups', 'codex', 'migrated-threads.json');
export const LEGACY_CODEX_MIGRATED_THREADS_PATH = path.join(homedir(), '.torve', 'codex-migrated-threads.json');

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

export type CodexEnsureClosedResult = {
  ok: boolean;
  wasRunning?: boolean;
  error?: string;
};

export type CodexThreadMigrationOptions = {
  dbPath?: string;
  codexDir?: string;
  manifestPath?: string;
  safetyBackupDir?: string;
  ensureCodexClosed?: () => Promise<CodexEnsureClosedResult>;
};

export function discoverCodexStateDbPaths(codexDir = CODEX_DIR): string[] {
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

function resolveTargetDbPaths(opts: CodexThreadMigrationOptions): string[] {
  if (opts.dbPath) {
    return existsSync(opts.dbPath) ? [opts.dbPath] : [];
  }
  return discoverCodexStateDbPaths(opts.codexDir ?? CODEX_DIR);
}

async function isCodexProcessRunning(): Promise<boolean> {
  try {
    if (process.platform === 'win32') {
      const { stdout } = await execFileAsync('tasklist', ['/NH', '/FO', 'CSV'], { windowsHide: true });
      const lines = stdout.toLowerCase().split(/\r?\n/);
      return lines.some((line) => line.startsWith('"codex.exe",') || line.startsWith('"chatgpt.exe",'));
    }
    const { stdout } = await execFileAsync('ps', ['-eo', 'comm='], {});
    const names = stdout.toLowerCase().split(/\r?\n/).map((s) => path.basename(s.trim()));
    return names.some((name) => name === 'codex' || name === 'codex.exe' || name === 'chatgpt');
  } catch {
    return false;
  }
}

async function defaultEnsureCodexClosed(): Promise<CodexEnsureClosedResult> {
  let wasRunning = false;
  if (process.versions['electron']) {
    const guiStop = await stopAppIfRunning('codex', { restartAppName: 'Codex' });
    if (!guiStop.ok) {
      return {
        ok: false,
        wasRunning: guiStop.wasRunning,
        error: guiStop.error ?? 'Close Codex before migrating threads so SQLite stays safe.',
      };
    }
    wasRunning = guiStop.wasRunning;
  }

  let running = await isCodexProcessRunning();
  if (running) {
    wasRunning = true;
    if (!process.versions['electron'] && process.platform === 'win32') {
      // Outside Electron (CLI / verification scripts), request graceful close, wait briefly, then force-close tree if minimized to tray.
      await execFileAsync('taskkill', ['/T', '/IM', 'Codex.exe'], { windowsHide: true }).catch(() => {});
      await execFileAsync('taskkill', ['/T', '/IM', 'ChatGPT.exe'], { windowsHide: true }).catch(() => {});
    }
    const graceDeadline = Date.now() + 2_500;
    while (running && Date.now() < graceDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      running = await isCodexProcessRunning();
    }
    if (running && !process.versions['electron'] && process.platform === 'win32') {
      await execFileAsync('taskkill', ['/F', '/T', '/IM', 'Codex.exe'], { windowsHide: true }).catch(() => {});
      await execFileAsync('taskkill', ['/F', '/T', '/IM', 'ChatGPT.exe'], { windowsHide: true }).catch(() => {});
      const forceDeadline = Date.now() + 3_000;
      while (running && Date.now() < forceDeadline) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        running = await isCodexProcessRunning();
      }
    }
  }
  if (running) {
    return {
      ok: false,
      wasRunning: true,
      error: 'Codex process is still running. Close Codex completely before touching SQLite.',
    };
  }
  return { ok: true, wasRunning };
}

async function ensurePreFlightClosed(opts: CodexThreadMigrationOptions): Promise<CodexEnsureClosedResult> {
  if (opts.ensureCodexClosed) {
    return opts.ensureCodexClosed();
  }
  return defaultEnsureCodexClosed();
}

async function backupCodexSqliteSafety(dbPath: string, safetyBackupDir: string): Promise<void> {
  await mkdir(safetyBackupDir, { recursive: true });
  const baseName = path.basename(dbPath);
  await copyFile(dbPath, path.join(safetyBackupDir, baseName));

  for (const suffix of ['-wal', '-shm'] as const) {
    const srcSidecar = `${dbPath}${suffix}`;
    const destSidecar = path.join(safetyBackupDir, `${baseName}${suffix}`);
    if (existsSync(srcSidecar)) {
      await copyFile(srcSidecar, destSidecar);
    } else if (existsSync(destSidecar)) {
      await unlink(destSidecar).catch(() => {});
    }
  }
}

async function openSqlite(dbPath: string): Promise<SqliteDb | null> {
  try {
    const mod = await import('better-sqlite3');
    const Database = mod.default;
    return new Database(dbPath, { timeout: 2000 }) as unknown as SqliteDb;
  } catch {
    // Fallback to Node's built-in node:sqlite when available (Node 22.5+).
    try {
      const mod = (await import('node:sqlite' as string)) as {
        DatabaseSync?: new (path: string) => SqliteDb;
      };
      if (typeof mod.DatabaseSync === 'function') {
        return new mod.DatabaseSync(dbPath);
      }
    } catch {
      // Neither SQLite binding is available in this runtime.
    }
    return null;
  }
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

async function writeManifestAtomic(manifestPath: string, manifest: Record<string, string>): Promise<void> {
  await mkdir(path.dirname(manifestPath), { recursive: true });
  const tempPath = `${manifestPath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  await rename(tempPath, manifestPath);
}

function normalizeRolloutPath(rawPath: string): string {
  if (rawPath.startsWith('\\\\?\\UNC\\')) {
    return `\\\\${rawPath.slice(8)}`;
  }
  if (rawPath.startsWith('\\\\?\\')) {
    return rawPath.slice(4);
  }
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
    // Best-effort: ignore locked, missing, or unwritable rollout files.
  }
}

export async function migrateCodexThreadsToTorve(
  opts: CodexThreadMigrationOptions = {},
): Promise<{ migratedCount: number; ok: boolean; error?: string; dbPaths?: string[] }> {
  const dbPaths = resolveTargetDbPaths(opts);
  const manifestPath = opts.manifestPath ?? CODEX_MIGRATED_THREADS_PATH;
  const safetyBackupDir = opts.safetyBackupDir ?? CODEX_SAFETY_BACKUP_DIR;

  if (dbPaths.length === 0) {
    return { ok: true, migratedCount: 0, dbPaths: [] };
  }

  const closed = await ensurePreFlightClosed(opts);
  if (!closed.ok) {
    return { ok: false, migratedCount: 0, error: closed.error ?? 'Codex is still running.', dbPaths };
  }

  let totalMigrated = 0;
  const rolloutJobs: Array<{ rolloutPath: string }> = [];

  for (const dbPath of dbPaths) {
    await backupCodexSqliteSafety(dbPath, safetyBackupDir);

    let db: SqliteDb | null = null;
    try {
      db = await openSqlite(dbPath);
      if (!db) continue;

      const columns = db.prepare('PRAGMA table_info(threads)').all() as TableInfoRow[];
      const hasThreadsTable = columns.some((col) => col.name === 'id') && columns.some((col) => col.name === 'model_provider');
      if (!hasThreadsTable) continue;

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
          await writeManifestAtomic(manifestPath, nextManifest);

          const updateStmt = db.prepare("UPDATE threads SET model_provider = 'torve' WHERE id = ?");
          for (const row of rows) {
            if (!row.id) continue;
            updateStmt.run(row.id);
          }
        }

        runSql(db, 'COMMIT');
        inTx = false;
      } catch (err) {
        if (inTx) {
          try {
            runSql(db, 'ROLLBACK');
          } catch {
            // Ignore rollback failure.
          }
        }
        throw err;
      }

      totalMigrated += rows.length;
      for (const row of rows) {
        if (typeof row.rollout_path === 'string' && row.rollout_path.trim().length > 0) {
          rolloutJobs.push({ rolloutPath: row.rollout_path });
        }
      }
    } catch (err) {
      return {
        ok: false,
        migratedCount: totalMigrated,
        error: err instanceof Error ? err.message : String(err),
        dbPaths,
      };
    } finally {
      try {
        db?.close();
      } catch {
        // Ignore close errors.
      }
    }
  }

  for (const job of rolloutJobs) {
    await patchRolloutSessionMeta(job.rolloutPath, 'torve');
  }

  return { ok: true, migratedCount: totalMigrated, dbPaths };
}

export async function restoreCodexThreadsFromTorve(
  opts: CodexThreadMigrationOptions = {},
): Promise<{ restoredCount: number; ok: boolean; error?: string; dbPaths?: string[] }> {
  const dbPaths = resolveTargetDbPaths(opts);
  const manifestPath = opts.manifestPath ?? CODEX_MIGRATED_THREADS_PATH;
  const safetyBackupDir = opts.safetyBackupDir ?? CODEX_SAFETY_BACKUP_DIR;
  const usingDefaultManifest = !opts.manifestPath || manifestPath === CODEX_MIGRATED_THREADS_PATH;

  const manifest = await readManifest(manifestPath);
  const legacyManifest = usingDefaultManifest ? await readManifest(LEGACY_CODEX_MIGRATED_THREADS_PATH) : {};
  const mergedManifest: Record<string, string> = { ...legacyManifest, ...manifest };
  const entries = Object.entries(mergedManifest);

  if (entries.length === 0) {
    await unlink(manifestPath).catch(() => {});
    if (usingDefaultManifest) {
      await unlink(LEGACY_CODEX_MIGRATED_THREADS_PATH).catch(() => {});
    }
    return { ok: true, restoredCount: 0, dbPaths };
  }

  if (dbPaths.length === 0) {
    await unlink(manifestPath).catch(() => {});
    if (usingDefaultManifest) {
      await unlink(LEGACY_CODEX_MIGRATED_THREADS_PATH).catch(() => {});
    }
    return { ok: true, restoredCount: 0, dbPaths: [] };
  }

  const closed = await ensurePreFlightClosed(opts);
  if (!closed.ok) {
    return { ok: false, restoredCount: 0, error: closed.error ?? 'Codex is still running.', dbPaths };
  }

  let restoredCount = 0;
  const rolloutRestores: Array<{ rolloutPath: string; originalProvider: string }> = [];

  for (const dbPath of dbPaths) {
    await backupCodexSqliteSafety(dbPath, safetyBackupDir);

    let db: SqliteDb | null = null;
    try {
      db = await openSqlite(dbPath);
      if (!db) continue;

      const columns = db.prepare('PRAGMA table_info(threads)').all() as TableInfoRow[];
      const hasThreadsTable = columns.some((col) => col.name === 'id') && columns.some((col) => col.name === 'model_provider');
      if (!hasThreadsTable) continue;

      const hasRolloutPath = columns.some((col) => col.name === 'rollout_path');
      const selectRolloutStmt = hasRolloutPath
        ? db.prepare("SELECT rollout_path FROM threads WHERE id = ? AND model_provider = 'torve'")
        : null;
      const updateStmt = db.prepare("UPDATE threads SET model_provider = ? WHERE id = ? AND model_provider = 'torve'");

      let inTx = false;
      try {
        runSql(db, 'BEGIN IMMEDIATE');
        inTx = true;

        for (const [threadId, originalProvider] of entries) {
          if (selectRolloutStmt) {
            const matches = selectRolloutStmt.all(threadId) as Array<{ rollout_path?: string | null }>;
            for (const row of matches) {
              if (typeof row.rollout_path === 'string' && row.rollout_path.trim().length > 0) {
                rolloutRestores.push({ rolloutPath: row.rollout_path, originalProvider });
              }
            }
          }
          const result = updateStmt.run(originalProvider, threadId) as { changes?: number | bigint } | undefined;
          if (result && result.changes !== undefined) {
            restoredCount += Number(result.changes);
          }
        }

        runSql(db, 'COMMIT');
        inTx = false;
      } catch (err) {
        if (inTx) {
          try {
            runSql(db, 'ROLLBACK');
          } catch {
            // Ignore rollback failure.
          }
        }
        throw err;
      }
    } catch (err) {
      return {
        ok: false,
        restoredCount,
        error: err instanceof Error ? err.message : String(err),
        dbPaths,
      };
    } finally {
      try {
        db?.close();
      } catch {
        // Ignore close errors.
      }
    }
  }

  for (const job of rolloutRestores) {
    await patchRolloutSessionMeta(job.rolloutPath, job.originalProvider);
  }

  await unlink(manifestPath).catch(() => {});
  if (usingDefaultManifest) {
    await unlink(LEGACY_CODEX_MIGRATED_THREADS_PATH).catch(() => {});
  }
  return { ok: true, restoredCount, dbPaths };
}
