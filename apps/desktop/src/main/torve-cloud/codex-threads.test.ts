import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  discoverCodexStateDbPaths,
  migrateCodexThreadsToTorve,
  restoreCodexThreadsFromTorve,
} from './codex-threads.js';

type TestDb = {
  exec: (sql: string) => unknown;
  prepare: (sql: string) => { all: (...p: unknown[]) => unknown[]; run: (...p: unknown[]) => unknown };
  close: () => void;
};

async function openTestDb(dbPath: string): Promise<TestDb> {
  try {
    const mod = (await import('node:sqlite' as string)) as {
      DatabaseSync?: new (p: string) => TestDb;
    };
    if (typeof mod.DatabaseSync === 'function') {
      return new mod.DatabaseSync(dbPath);
    }
  } catch {
    // Fallback to better-sqlite3 on older Node versions.
  }
  const mod = await import('better-sqlite3');
  const Database = mod.default;
  return new Database(dbPath) as unknown as TestDb;
}

async function createTempCodexDb(dir: string, fileName = 'state_5.sqlite', rolloutPath?: string): Promise<string> {
  const dbPath = path.join(dir, fileName);
  const db = await openTestDb(dbPath);
  try {
    db.exec(`
      CREATE TABLE threads (
        id TEXT PRIMARY KEY,
        model_provider TEXT,
        title TEXT,
        first_user_message TEXT,
        created_at INTEGER,
        updated_at INTEGER,
        rollout_path TEXT
      );
    `);
    const insert = db.prepare(
      'INSERT INTO threads (id, model_provider, title, first_user_message, created_at, updated_at, rollout_path) VALUES (?, ?, ?, ?, ?, ?, ?)',
    );
    insert.run('thread-openai', 'openai', 'Old project', 'analyse project', 1000, 2000, rolloutPath ?? null);
    insert.run('thread-router', 'codex-router', 'Router chat', 'hi', 1001, 2001, null);
    insert.run('thread-ollama', 'ollama', 'Local chat', 'local', 1002, 2002, null);
    insert.run('thread-torve', 'torve', 'Existing Torve chat', 'already torve', 1003, 2003, null);
  } finally {
    db.close();
  }
  // Create companion WAL/SHM files to verify sqlite-safety backup copies them too.
  writeFileSync(`${dbPath}-wal`, 'wal-bytes', 'utf8');
  writeFileSync(`${dbPath}-shm`, 'shm-bytes', 'utf8');
  return dbPath;
}

async function readThreadRows(dbPath: string): Promise<Array<{
  id: string;
  model_provider: string | null;
  title: string | null;
  first_user_message: string | null;
  created_at: number;
  updated_at: number;
}>> {
  const db = await openTestDb(dbPath);
  try {
    return db
      .prepare('SELECT id, model_provider, title, first_user_message, created_at, updated_at FROM threads ORDER BY id')
      .all() as Array<{
      id: string;
      model_provider: string | null;
      title: string | null;
      first_user_message: string | null;
      created_at: number;
      updated_at: number;
    }>;
  } finally {
    db.close();
  }
}

async function readThreadProviders(dbPath: string): Promise<Record<string, string | null>> {
  return Object.fromEntries((await await readThreadRows(dbPath)).map((row) => [row.id, row.model_provider]));
}

test('dynamic discovery + Toggle ON migrates non-torve rows, backs up sqlite+wal+shm, patches rollout JSONL, and is idempotent', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'torve-codex-threads-'));
  try {
    const rolloutPath = path.join(dir, 'rollout-1.jsonl');
    const extendedRolloutPath = process.platform === 'win32' ? `\\\\?\\${rolloutPath}` : rolloutPath;
    writeFileSync(
      rolloutPath,
      [
        JSON.stringify({ timestamp: '2026-01-01T00:00:00Z', type: 'session_meta', payload: { id: 'thread-openai', model_provider: 'openai' } }),
        JSON.stringify({ timestamp: '2026-01-01T00:00:01Z', type: 'response_item', payload: { text: 'hello' } }),
      ].join('\n') + '\n',
      'utf8',
    );

    const db5 = await createTempCodexDb(dir, 'state_5.sqlite', extendedRolloutPath);
    const db6 = await createTempCodexDb(dir, 'state_6.sqlite');
    const safetyBackupDir = path.join(dir, 'sqlite-safety');
    const manifestPath = path.join(dir, 'migrated-threads.json');

    assert.deepEqual(discoverCodexStateDbPaths(dir), [db5, db6]);

    const result = await migrateCodexThreadsToTorve({
      codexDir: dir,
      manifestPath,
      safetyBackupDir,
      ensureCodexClosed: async () => ({ ok: true }),
    });
    assert.equal(result.ok, true);
    assert.equal(result.migratedCount, 6);

    assert.equal(existsSync(path.join(safetyBackupDir, 'state_5.sqlite')), true);
    assert.equal(existsSync(path.join(safetyBackupDir, 'state_5.sqlite-wal')), true);
    assert.equal(existsSync(path.join(safetyBackupDir, 'state_5.sqlite-shm')), true);
    assert.equal(existsSync(path.join(safetyBackupDir, 'state_6.sqlite')), true);

    assert.deepEqual(await readThreadProviders(db5), {
      'thread-ollama': 'torve',
      'thread-openai': 'torve',
      'thread-router': 'torve',
      'thread-torve': 'torve',
    });

    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, string>;
    assert.deepEqual(manifest, {
      'thread-ollama': 'ollama',
      'thread-openai': 'openai',
      'thread-router': 'codex-router',
    });

    const rolloutLines = (await readFile(rolloutPath, 'utf8')).trim().split('\n');
    const sessionMeta = JSON.parse(rolloutLines[0]!) as { payload: { model_provider: string } };
    assert.equal(sessionMeta.payload.model_provider, 'torve');

    // Re-running migration is idempotent and never overwrites original providers.
    const secondRun = await migrateCodexThreadsToTorve({
      codexDir: dir,
      manifestPath,
      safetyBackupDir,
      ensureCodexClosed: async () => ({ ok: true }),
    });
    assert.equal(secondRun.ok, true);
    assert.equal(secondRun.migratedCount, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Toggle OFF is non-destructive: preserves new chats created while ON, restores old providers + rollout, and supports ON->OFF->ON', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'torve-codex-restore-'));
  try {
    const rolloutPath = path.join(dir, 'rollout-old.jsonl');
    writeFileSync(
      rolloutPath,
      [
        JSON.stringify({ timestamp: '2026-01-01T00:00:00Z', type: 'session_meta', payload: { id: 'thread-openai', model_provider: 'openai' } }),
        JSON.stringify({ timestamp: '2026-01-01T00:00:01Z', type: 'response_item', payload: { text: 'important old history' } }),
      ].join('\n') + '\n',
      'utf8',
    );
    const dbPath = await createTempCodexDb(dir, 'state_5.sqlite', rolloutPath);
    const manifestPath = path.join(dir, 'migrated-threads.json');
    const safetyBackupDir = path.join(dir, 'sqlite-safety');

    // 1. Toggle ON
    const firstOn = await migrateCodexThreadsToTorve({
      dbPath,
      manifestPath,
      safetyBackupDir,
      ensureCodexClosed: async () => ({ ok: true }),
    });
    assert.equal(firstOn.migratedCount, 3);

    // 2. User creates a brand-new chat while Torve is ON, and manually switches thread-router to custom.
    const newRollout = path.join(dir, 'rollout-new.jsonl');
    writeFileSync(
      newRollout,
      JSON.stringify({ timestamp: '2026-01-02T00:00:00Z', type: 'session_meta', payload: { id: 'thread-new-while-on', model_provider: 'torve' } }) + '\n',
      'utf8',
    );
    const db = await openTestDb(dbPath);
    try {
      db.prepare(
        'INSERT INTO threads (id, model_provider, title, first_user_message, created_at, updated_at, rollout_path) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).run('thread-new-while-on', 'torve', 'New Torve Chat', 'created while torve ON', 3000, 3500, newRollout);
      db.prepare("UPDATE threads SET model_provider = 'custom' WHERE id = 'thread-router'").run();
    } finally {
      db.close();
    }

    // 3. Toggle OFF
    const restored = await restoreCodexThreadsFromTorve({
      dbPath,
      manifestPath,
      safetyBackupDir,
      ensureCodexClosed: async () => ({ ok: true }),
    });
    assert.equal(restored.ok, true);
    assert.equal(restored.restoredCount, 2); // thread-openai + thread-ollama (thread-router was manually switched)
    assert.equal(existsSync(manifestPath), false);

    // Verify new chat created while ON is 100% preserved, AND old thread metadata/titles/timestamps are intact!
    const rowsAfterOff = await readThreadRows(dbPath);
    assert.equal(rowsAfterOff.length, 5);
    assert.deepEqual(await readThreadProviders(dbPath), {
      'thread-new-while-on': 'torve',
      'thread-ollama': 'ollama',
      'thread-openai': 'openai',
      'thread-router': 'custom',
      'thread-torve': 'torve',
    });
    const newRow = rowsAfterOff.find((r) => r.id === 'thread-new-while-on');
    assert.equal(newRow?.title, 'New Torve Chat');
    assert.equal(newRow?.first_user_message, 'created while torve ON');
    assert.equal(newRow?.created_at, 3000);

    // Rollout session_meta for restored thread goes back to openai!
    const rolloutAfterOff = JSON.parse((await readFile(rolloutPath, 'utf8')).trim().split('\n')[0]!) as { payload: { model_provider: string } };
    assert.equal(rolloutAfterOff.payload.model_provider, 'openai');

    // 4. Toggle ON again (ON -> OFF -> ON cycle)
    const secondOn = await migrateCodexThreadsToTorve({
      dbPath,
      manifestPath,
      safetyBackupDir,
      ensureCodexClosed: async () => ({ ok: true }),
    });
    assert.equal(secondOn.ok, true);
    assert.equal(secondOn.migratedCount, 3); // openai, ollama, router(custom)
    assert.deepEqual(await readThreadProviders(dbPath), {
      'thread-new-while-on': 'torve',
      'thread-ollama': 'torve',
      'thread-openai': 'torve',
      'thread-router': 'torve',
      'thread-torve': 'torve',
    });
    const rowsAfterSecondOn = await readThreadRows(dbPath);
    assert.equal(rowsAfterSecondOn.length, 5);
    assert.equal(rowsAfterSecondOn.find((r) => r.id === 'thread-openai')?.title, 'Old project');
    assert.equal(rowsAfterSecondOn.find((r) => r.id === 'thread-new-while-on')?.first_user_message, 'created while torve ON');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('pre-flight abort when Codex is still running does not touch SQLite or create manifest', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'torve-codex-locked-'));
  try {
    const dbPath = await createTempCodexDb(dir, 'state_5.sqlite');
    const manifestPath = path.join(dir, 'migrated-threads.json');
    const safetyBackupDir = path.join(dir, 'sqlite-safety');
    await mkdir(safetyBackupDir, { recursive: true });

    const res = await migrateCodexThreadsToTorve({
      dbPath,
      manifestPath,
      safetyBackupDir,
      ensureCodexClosed: async () => ({ ok: false, wasRunning: true, error: 'Codex is still running.' }),
    });
    assert.equal(res.ok, false);
    assert.equal(res.migratedCount, 0);
    assert.match(res.error ?? '', /still running/i);
    assert.equal(existsSync(manifestPath), false);
    assert.equal((await readThreadProviders(dbPath))['thread-openai'], 'openai');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('migrateCodexThreadsToTorve and restoreCodexThreadsFromTorve are safe no-ops when state_*.sqlite is missing', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'torve-codex-missing-'));
  try {
    const dbPath = path.join(dir, 'missing-state_5.sqlite');
    const manifestPath = path.join(dir, 'migrated-threads.json');

    const migrated = await migrateCodexThreadsToTorve({
      dbPath,
      manifestPath,
      ensureCodexClosed: async () => ({ ok: true }),
    });
    assert.equal(migrated.ok, true);
    assert.equal(migrated.migratedCount, 0);
    assert.equal(existsSync(manifestPath), false);

    const restored = await restoreCodexThreadsFromTorve({
      dbPath,
      manifestPath,
      ensureCodexClosed: async () => ({ ok: true }),
    });
    assert.equal(restored.ok, true);
    assert.equal(restored.restoredCount, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
