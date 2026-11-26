import { spawn } from 'node:child_process';
import { closeSync, mkdirSync, openSync } from 'node:fs';
import path from 'node:path';
import { torveCloudUpstream } from './api.js';
import { startProxyServer, stopProxyServer } from './proxy.js';
import {
  DEFAULT_PROXY_PORT,
  getTorveDir,
  isProcessAlive,
  proxyLogPath,
  proxyPidPath,
  readProxyPid,
  removeProxyPid,
  writeProxyPid,
} from './state.js';

export interface ProxyProbeResult {
  running: boolean;
  hostedBy: 'cli' | 'desktop' | null;
  authenticated: boolean;
  pid: number | null;
  port: number;
}

export async function probeProxyHealth(port = DEFAULT_PROXY_PORT): Promise<ProxyProbeResult> {
  const pidInfo = await readProxyPid();
  const cliPidAlive = pidInfo && pidInfo.port === port && isProcessAlive(pidInfo.pid) ? pidInfo.pid : null;

  try {
    const resp = await fetch(`http://127.0.0.1:${port}/_torve/health`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(1_200),
    });
    if (resp.ok) {
      const json = await resp.json() as { service?: unknown; authenticated?: unknown; pid?: unknown };
      if (json.service === 'torve-cli-proxy') {
        return {
          running: true,
          hostedBy: 'cli',
          authenticated: json.authenticated === true,
          pid: typeof json.pid === 'number' ? json.pid : cliPidAlive,
          port,
        };
      }
    }
  } catch { /* fall through to /v1/models probe */ }

  try {
    const resp = await fetch(`http://127.0.0.1:${port}/v1/models`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(1_500),
    });
    if (resp.ok) {
      return {
        running: true,
        hostedBy: cliPidAlive ? 'cli' : 'desktop',
        authenticated: true,
        pid: cliPidAlive,
        port,
      };
    }
    if (resp.status === 401) {
      const body = await resp.json().catch(() => null) as { error?: { type?: unknown } } | null;
      if (body?.error?.type === 'torve_cloud_error') {
        return {
          running: true,
          hostedBy: cliPidAlive ? 'cli' : 'desktop',
          authenticated: false,
          pid: cliPidAlive,
          port,
        };
      }
    }
  } catch { /* not listening */ }

  return {
    running: false,
    hostedBy: null,
    authenticated: false,
    pid: null,
    port,
  };
}

export interface StartProxyResult {
  started: boolean;
  alreadyRunning: boolean;
  hostedBy: 'cli' | 'desktop';
  port: number;
  pid: number | null;
  logPath?: string;
}

export async function startProxyDaemon(opts: {
  port?: number;
  foreground?: boolean;
  entryScript?: string;
}): Promise<StartProxyResult> {
  const port = opts.port ?? DEFAULT_PROXY_PORT;
  const existing = await probeProxyHealth(port);
  if (existing.running) {
    return {
      started: false,
      alreadyRunning: true,
      hostedBy: existing.hostedBy ?? 'desktop',
      port,
      pid: existing.pid,
    };
  }

  if (opts.foreground) {
    const boundPort = await startProxyServer(port);
    await writeProxyPid({
      pid: process.pid,
      port: boundPort,
      startedAt: Date.now(),
      upstream: torveCloudUpstream(),
    });
    const shutdown = async () => {
      await stopProxyServer().catch(() => {});
      await removeProxyPid().catch(() => {});
      process.exit(0);
    };
    process.once('SIGINT', () => { void shutdown(); });
    process.once('SIGTERM', () => { void shutdown(); });
    return {
      started: true,
      alreadyRunning: false,
      hostedBy: 'cli',
      port: boundPort,
      pid: process.pid,
    };
  }

  const entry = opts.entryScript || process.argv[1];
  if (!entry) {
    throw new Error('Cannot determine CLI entrypoint path for background daemon.');
  }

  mkdirSync(getTorveDir(), { recursive: true });
  const logFile = proxyLogPath();
  const logFd = openSync(logFile, 'a');
  let childPid: number | undefined;
  try {
    const child = spawn(
      process.execPath,
      [...process.execArgv, entry, 'start', '--foreground', '--port', String(port)],
      {
        detached: true,
        stdio: ['ignore', logFd, logFd],
        windowsHide: true,
        env: process.env,
      },
    );
    childPid = child.pid;
    child.unref();
  } finally {
    closeSync(logFd);
  }

  const deadline = Date.now() + 6_000;
  while (Date.now() < deadline) {
    const health = await probeProxyHealth(port);
    if (health.running) {
      return {
        started: true,
        alreadyRunning: false,
        hostedBy: 'cli',
        port,
        pid: health.pid ?? childPid ?? null,
        logPath: logFile,
      };
    }
    await new Promise((r) => setTimeout(r, 120));
  }

  throw new Error(`Torve proxy failed to become healthy on 127.0.0.1:${port}. Check ${logFile}`);
}

export interface StopProxyResult {
  stopped: boolean;
  hostedByDesktop: boolean;
  stalePidCleaned: boolean;
  pid: number | null;
  port: number;
  message: string;
}

export async function stopProxyDaemon(port = DEFAULT_PROXY_PORT): Promise<StopProxyResult> {
  const pidInfo = await readProxyPid();
  const health = await probeProxyHealth(port);

  if (!pidInfo) {
    if (health.running && health.hostedBy === 'desktop') {
      return {
        stopped: false,
        hostedByDesktop: true,
        stalePidCleaned: false,
        pid: null,
        port,
        message: `Proxy on 127.0.0.1:${port} is hosted by Torve Desktop (not started by torve CLI). Stop it from Torve Desktop.`,
      };
    }
    return {
      stopped: false,
      hostedByDesktop: false,
      stalePidCleaned: false,
      pid: null,
      port,
      message: `No CLI-managed Torve proxy is running (no PID file at ${proxyPidPath()}).`,
    };
  }

  if (!isProcessAlive(pidInfo.pid)) {
    await removeProxyPid();
    if (health.running && health.hostedBy === 'desktop') {
      return {
        stopped: false,
        hostedByDesktop: true,
        stalePidCleaned: true,
        pid: pidInfo.pid,
        port,
        message: `Cleaned stale CLI PID file; 127.0.0.1:${port} is currently hosted by Torve Desktop.`,
      };
    }
    return {
      stopped: false,
      hostedByDesktop: false,
      stalePidCleaned: true,
      pid: pidInfo.pid,
      port: pidInfo.port,
      message: `Cleaned stale PID file (${pidInfo.pid}); proxy was not running.`,
    };
  }

  try {
    process.kill(pidInfo.pid, 'SIGTERM');
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code !== 'ESRCH') throw err;
  }

  const deadline = Date.now() + 3_500;
  while (Date.now() < deadline && isProcessAlive(pidInfo.pid)) {
    await new Promise((r) => setTimeout(r, 100));
  }

  if (isProcessAlive(pidInfo.pid)) {
    try { process.kill(pidInfo.pid, 'SIGKILL'); } catch { /* ignore */ }
  }
  await removeProxyPid();

  return {
    stopped: true,
    hostedByDesktop: false,
    stalePidCleaned: false,
    pid: pidInfo.pid,
    port: pidInfo.port,
    message: `Stopped Torve proxy (PID ${pidInfo.pid}) on 127.0.0.1:${pidInfo.port}.`,
  };
}

export function formatProxyPathHint(): string {
  return path.dirname(proxyPidPath());
}
