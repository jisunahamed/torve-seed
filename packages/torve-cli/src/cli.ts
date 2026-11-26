import os from 'node:os';
import {
  buildDesktopAuthUrl,
  exchangeDesktopAuthCode,
  fetchDesktopMe,
  fetchModelsFromLocalProxy,
  fetchTorveDesktopModelsEndpoint,
  fetchTorveModelsUpstream,
  generatePkcePair,
  openExternalUrl,
  readModelsCache,
  revokeDesktopAuthKey,
  startLoopbackPkceServer,
  torveCloudUpstream,
} from './api.js';
import { listAppsStatus } from './apps.js';
import {
  disableAllApps,
  disableApp,
  enableAllDetectedApps,
  enableApp,
  MIN_CONTEXT_WINDOW_FLOOR,
  MIN_OUTPUT_TOKENS_FLOOR,
} from './config-patch.js';
import { probeProxyHealth, startProxyDaemon, stopProxyDaemon } from './daemon.js';
import {
  clearAllSharedTorveState,
  clearCliCredentials,
  DEFAULT_PROXY_PORT,
  hasDesktopEncryptedCredentials,
  maskApiKey,
  readCliConfig,
  resolveCredentials,
  saveCliCredentials,
} from './state.js';
import type { TorveModel } from './types.js';

export const CLI_VERSION = '0.1.0';

export interface ParsedCliArgs {
  command: string;
  positionals: string[];
  json: boolean;
  help: boolean;
  version: boolean;
  port: number;
  portExplicit: boolean;
  token?: string;
  foreground: boolean;
  daemon: boolean;
  all: boolean;
}

export function parseCliArgs(argv: readonly string[]): ParsedCliArgs {
  let command = '';
  const positionals: string[] = [];
  let json = false;
  let help = false;
  let version = false;
  let port = Number(process.env['TORVE_CLOUD_PROXY_PORT']) || DEFAULT_PROXY_PORT;
  let portExplicit = false;
  let token: string | undefined;
  let foreground = false;
  let daemon = false;
  let all = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--json') { json = true; continue; }
    if (arg === '--help' || arg === '-h') { help = true; continue; }
    if (arg === '--version' || arg === '-v') { version = true; continue; }
    if (arg === '--foreground' || arg === '-f') { foreground = true; continue; }
    if (arg === '--daemon' || arg === '-d') { daemon = true; continue; }
    if (arg === '--all') { all = true; continue; }

    if (arg === '--port' || arg === '-p') {
      const val = argv[++i];
      const parsed = Number(val);
      if (!val || !Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
        throw new Error(`Invalid port value: ${val ?? '(missing)'}`);
      }
      port = parsed;
      portExplicit = true;
      continue;
    }
    if (arg.startsWith('--port=')) {
      const val = arg.slice('--port='.length);
      const parsed = Number(val);
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
        throw new Error(`Invalid port value: ${val}`);
      }
      port = parsed;
      portExplicit = true;
      continue;
    }

    if (arg === '--token' || arg === '-t') {
      const val = argv[++i];
      if (!val || !val.trim()) throw new Error('Missing value for --token.');
      token = val.trim();
      continue;
    }
    if (arg.startsWith('--token=')) {
      const val = arg.slice('--token='.length).trim();
      if (!val) throw new Error('Missing value for --token.');
      token = val;
      continue;
    }

    if (arg.startsWith('-')) {
      throw new Error(`Unknown flag: ${arg}`);
    }

    if (!command) command = arg.toLowerCase();
    else positionals.push(arg);
  }

  return { command, positionals, json, help, version, port, portExplicit, token, foreground, daemon, all };
}

function printHelp(command?: string): void {
  if (command === 'on' || command === 'off') {
    console.log([
      `Usage: torve ${command} <app|all> [options]`,
      '',
      command === 'on'
        ? 'Backs up existing config and patches <app> (or all detected apps) to route via Torve proxy.'
        : 'Restores backup or removes Torve config patch from <app> (or all apps).',
      '',
      'Options:',
      '  --port <n>    Proxy port (default: 8378)',
      '  --token <k>   Use API key override',
      '  --json        Output JSON',
    ].join('\n'));
    return;
  }

  console.log([
    `torve v${CLI_VERSION} — Standalone companion CLI for Torve Cloud`,
    '',
    'Usage: torve <command> [options]',
    '',
    'Commands:',
    '  login              Sign in via browser PKCE flow (or --token <api_key>)',
    '  logout             Clear stored CLI credentials (--all clears shared ~/.torve state)',
    '  apps               List supported AI apps, detection status, and ON/OFF state',
    '  on <app|all>       Back up and patch app config to route through Torve proxy',
    '  off <app|all>      Restore backup or unpatch app config',
    '  start              Start standalone Torve proxy on 127.0.0.1:8378',
    '  stop               Stop the CLI-started Torve proxy daemon',
    '  models             List available Torve Cloud models with context/output limits',
    '  status             Show account, proxy health, and connected apps summary',
    '',
    'Global Options:',
    '  --port <n>         Override local proxy port (default: 8378)',
    '  --token <key>      Torve API key (for headless login or direct override)',
    '  --foreground       Run proxy in foreground (for `torve start`)',
    '  --daemon           Run proxy detached in background (default for `torve start`)',
    '  --all              Clear shared state (for `torve logout`)',
    '  --json             Machine-readable JSON output',
    '  -h, --help         Show help',
    '  -v, --version      Show version',
  ].join('\n'));
}

async function resolveAvailableModels(port: number, tokenOverride?: string): Promise<TorveModel[]> {
  const creds = await resolveCredentials(tokenOverride);
  if (creds) {
    try {
      return await fetchTorveModelsUpstream(creds.apiKey);
    } catch { /* try desktop endpoint or local proxy */ }
    const fromDesktop = await fetchTorveDesktopModelsEndpoint(creds.apiKey);
    if (fromDesktop && fromDesktop.length > 0) return fromDesktop;
  }
  const fromProxy = await fetchModelsFromLocalProxy(port);
  if (fromProxy && fromProxy.length > 0) return fromProxy;
  const cached = await readModelsCache();
  return cached?.models ?? [];
}

async function cmdLogin(args: ParsedCliArgs): Promise<number> {
  if (args.token) {
    const [me, models] = await Promise.all([
      fetchDesktopMe(args.token),
      fetchTorveModelsUpstream(args.token, { force: true }),
    ]);
    await saveCliCredentials({
      apiKey: args.token,
      authMode: 'manual',
      email: me.user.email,
      keyMeta: me.key,
      userMeta: me.user,
    });
    if (args.json) {
      console.log(JSON.stringify({ ok: true, authMode: 'manual', user: me.user, key: me.key, modelsCount: models.length }, null, 2));
    } else {
      console.log(`Connected as ${me.user.email || me.user.name || 'Torve user'} (${me.user.plan || 'standard'} plan).`);
      console.log(`Cached ${models.length} models. Key: ${maskApiKey(args.token)}`);
    }
    return 0;
  }

  const pkce = generatePkcePair();
  const deviceName = os.hostname() || 'Torve CLI';
  let resolveFlow!: (code: { code: string; redirectUri: string }) => void;
  let rejectFlow!: (err: Error) => void;
  const flowPromise = new Promise<{ code: string; redirectUri: string }>((res, rej) => {
    resolveFlow = res;
    rejectFlow = rej;
  });

  const handle = await startLoopbackPkceServer({
    expectedState: pkce.state,
    onCode: async (code, redirectUri) => {
      resolveFlow({ code, redirectUri });
    },
    onError: (msg) => rejectFlow(new Error(msg)),
  });

  const authUrl = buildDesktopAuthUrl({
    redirectUri: handle.redirectUri,
    state: pkce.state,
    codeChallenge: pkce.codeChallenge,
    deviceName,
  });

  if (!args.json) {
    const opened = openExternalUrl(authUrl);
    console.log(opened
      ? 'Opened Torve sign-in in your browser. Waiting for authorization...'
      : 'Open this URL in your browser to sign in to Torve:');
    console.log(`  ${authUrl}`);
  }

  const { code, redirectUri } = await flowPromise;
  const exchanged = await exchangeDesktopAuthCode({
    code,
    codeVerifier: pkce.codeVerifier,
    redirectUri,
    deviceName,
  });

  const [me, models] = await Promise.all([
    fetchDesktopMe(exchanged.apiKey).catch(() => null),
    fetchTorveModelsUpstream(exchanged.apiKey, { force: true }).catch(() => [] as TorveModel[]),
  ]);

  await saveCliCredentials({
    apiKey: exchanged.apiKey,
    authMode: 'oauth',
    email: me?.user.email ?? exchanged.user.email,
    keyMeta: me?.key ?? exchanged.key,
    userMeta: me?.user ?? exchanged.user,
  });

  if (args.json) {
    console.log(JSON.stringify({
      ok: true,
      authMode: 'oauth',
      user: me?.user ?? exchanged.user,
      key: me?.key ?? exchanged.key,
      modelsCount: models.length,
    }, null, 2));
  } else {
    const email = me?.user.email ?? exchanged.user.email ?? 'Torve user';
    const plan = me?.user.plan ?? exchanged.user.plan ?? 'connected';
    console.log(`Signed in as ${email} (${plan}). Cached ${models.length} models.`);
  }
  return 0;
}

async function cmdLogout(args: ParsedCliArgs): Promise<number> {
  const creds = await resolveCredentials();
  let revoked = false;
  if (creds && creds.source === 'cli-config' && creds.authMode === 'oauth') {
    const res = await revokeDesktopAuthKey(creds.apiKey).catch(() => ({ revoked: false }));
    revoked = res.revoked;
  }
  const clearedCli = await clearCliCredentials();
  let clearedShared: string[] = [];
  if (args.all) {
    await stopProxyDaemon(args.port).catch(() => {});
    clearedShared = await clearAllSharedTorveState();
  }
  const desktopEncStillPresent = !args.all && hasDesktopEncryptedCredentials();

  if (args.json) {
    console.log(JSON.stringify({ ok: true, revoked, clearedCli, clearedShared, desktopCredentialsRemaining: desktopEncStillPresent }, null, 2));
  } else {
    console.log(clearedCli ? 'Cleared Torve CLI credentials (~/.torve/config.json).' : 'No stored CLI credentials found.');
    if (revoked) console.log('Revoked OAuth device key on Torve Cloud.');
    if (args.all) {
      console.log(clearedShared.length > 0 ? `Cleared shared state: ${clearedShared.join(', ')}` : 'No shared state files to clear.');
    } else if (desktopEncStillPresent) {
      console.log('Note: Torve Desktop credentials (~/.torve/desktop-credentials.enc) were kept. Pass --all to remove shared Desktop state.');
    }
  }
  return 0;
}

function cmdApps(args: ParsedCliArgs): number {
  const apps = listAppsStatus();
  if (args.json) {
    console.log(JSON.stringify({ apps }, null, 2));
    return 0;
  }
  const pad = (s: string, w: number) => s.padEnd(w, ' ');
  console.log(`${pad('APP', 16)} ${pad('NAME', 20)} ${pad('DETECTED', 10)} ${pad('STATUS', 8)} CONFIG`);
  for (const app of apps) {
    console.log(`${pad(app.name, 16)} ${pad(app.displayName, 20)} ${pad(app.detected ? 'yes' : 'no', 10)} ${pad(app.status, 8)} ${app.configPath}`);
  }
  return 0;
}

async function cmdOn(args: ParsedCliArgs): Promise<number> {
  const target = args.positionals[0]?.toLowerCase();
  if (!target) {
    throw new Error('Specify an app name or "all". Example: torve on codex');
  }

  const creds = await resolveCredentials(args.token);
  const proxy = await probeProxyHealth(args.port);
  if (!creds && !(proxy.running && proxy.authenticated)) {
    throw new Error('Not signed in to Torve. Run "torve login" (or pass --token <api_key>) first.');
  }

  const models = await resolveAvailableModels(args.port, args.token);
  if (target === 'codex' && models.length === 0) {
    // Allow codex with baseline auto entry if offline/unfetched, or fetch failed
    models.push({ id: 'auto', name: 'Torve Auto' });
  }

  const results = target === 'all'
    ? await enableAllDetectedApps({ port: args.port, models })
    : [await enableApp(target, { port: args.port, models })];

  if (args.json) {
    console.log(JSON.stringify({ ok: true, port: args.port, results }, null, 2));
  } else if (results.length === 0) {
    console.log('No supported apps detected on disk. Specify an app explicitly (e.g. "torve on opencode").');
  } else {
    for (const r of results) console.log(r.message);
    if (!proxy.running) {
      console.log(`Tip: Run "torve start" to start the local Torve proxy on 127.0.0.1:${args.port}.`);
    }
  }
  return 0;
}

async function cmdOff(args: ParsedCliArgs): Promise<number> {
  const target = args.positionals[0]?.toLowerCase();
  if (!target) {
    throw new Error('Specify an app name or "all". Example: torve off codex');
  }
  const results = target === 'all' ? await disableAllApps() : [await disableApp(target)];
  if (args.json) {
    console.log(JSON.stringify({ ok: true, results }, null, 2));
  } else if (results.length === 0) {
    console.log('No Torve-patched apps found.');
  } else {
    for (const r of results) console.log(r.message);
  }
  return 0;
}

async function cmdStart(args: ParsedCliArgs): Promise<number> {
  const foreground = args.foreground && !args.daemon;
  const result = await startProxyDaemon({ port: args.port, foreground });
  if (foreground) {
    if (args.json) {
      console.log(JSON.stringify({ ok: true, ...result }, null, 2));
    } else {
      console.log(`Torve proxy listening on http://127.0.0.1:${result.port} (foreground, PID ${result.pid}).`);
    }
    // Keep foreground process alive until SIGINT/SIGTERM
    await new Promise<void>(() => {});
  }
  if (args.json) {
    console.log(JSON.stringify({ ok: true, ...result }, null, 2));
  } else if (result.alreadyRunning) {
    const owner = result.hostedBy === 'desktop' ? 'Torve Desktop' : `CLI daemon (PID ${result.pid ?? 'unknown'})`;
    console.log(`Torve proxy is already running on http://127.0.0.1:${result.port} via ${owner}.`);
  } else {
    console.log(`Started Torve proxy daemon on http://127.0.0.1:${result.port} (PID ${result.pid ?? 'unknown'}).`);
  }
  return 0;
}

async function cmdStop(args: ParsedCliArgs): Promise<number> {
  const result = await stopProxyDaemon(args.port);
  if (args.json) {
    console.log(JSON.stringify({ ok: !result.hostedByDesktop, ...result }, null, 2));
  } else {
    console.log(result.message);
  }
  return 0;
}

async function cmdModels(args: ParsedCliArgs): Promise<number> {
  const creds = await resolveCredentials(args.token);
  const proxy = await probeProxyHealth(args.port);
  let models: TorveModel[] = [];
  let source = 'none';

  if (creds) {
    const desktopModels = await fetchTorveDesktopModelsEndpoint(creds.apiKey);
    if (desktopModels && desktopModels.length > 0) {
      models = desktopModels;
      source = 'api/desktop/models';
    } else {
      models = await fetchTorveModelsUpstream(creds.apiKey, { force: true });
      source = 'v1/models';
    }
  } else if (proxy.running && proxy.authenticated) {
    models = (await fetchModelsFromLocalProxy(args.port)) ?? [];
    source = `127.0.0.1:${args.port}/v1/models`;
  } else {
    const cached = await readModelsCache();
    if (cached && cached.models.length > 0) {
      models = cached.models;
      source = 'cache';
    } else {
      throw new Error('Not signed in and no live Torve proxy found. Run "torve login" first.');
    }
  }

  const normalized = models.map((m) => {
    const ctx = Number(m['max_input_tokens'] ?? m['context_window'] ?? m['context_length'] ?? 0) || MIN_CONTEXT_WINDOW_FLOOR;
    const out = Math.max(Number(m['max_output_tokens'] ?? m['max_tokens'] ?? 0) || 0, MIN_OUTPUT_TOKENS_FLOOR);
    return {
      id: m.id,
      name: typeof m['display_name'] === 'string' ? m['display_name'] : (typeof m['name'] === 'string' ? m['name'] : m.id),
      contextWindow: Math.max(ctx, MIN_CONTEXT_WINDOW_FLOOR),
      maxOutputTokens: out,
    };
  });

  if (args.json) {
    console.log(JSON.stringify({ source, count: normalized.length, models: normalized }, null, 2));
    return 0;
  }

  const pad = (s: string, w: number) => s.padEnd(w, ' ');
  console.log(`Models (${normalized.length}, source: ${source}):`);
  console.log(`${pad('ID', 34)} ${pad('CONTEXT', 12)} ${pad('MAX OUTPUT', 12)} NAME`);
  for (const m of normalized) {
    console.log(`${pad(m.id, 34)} ${pad(m.contextWindow.toLocaleString('en-US'), 12)} ${pad(m.maxOutputTokens.toLocaleString('en-US'), 12)} ${m.name}`);
  }
  return 0;
}

async function cmdStatus(args: ParsedCliArgs): Promise<number> {
  const creds = await resolveCredentials(args.token);
  const cliConfig = await readCliConfig();
  const proxy = await probeProxyHealth(args.port);
  const apps = listAppsStatus();
  const connectedApps = apps.filter((a) => a.patched).map((a) => a.name);
  const detectedApps = apps.filter((a) => a.detected).map((a) => a.name);

  let me = null;
  let meError: string | null = null;
  if (creds) {
    try {
      me = await fetchDesktopMe(creds.apiKey);
    } catch (err) {
      meError = err instanceof Error ? err.message : String(err);
    }
  }

  const payload = {
    version: CLI_VERSION,
    upstream: torveCloudUpstream(),
    auth: {
      authenticated: Boolean(creds) || (proxy.running && proxy.authenticated),
      source: creds?.source ?? (proxy.running && proxy.authenticated ? 'desktop-proxy' : null),
      email: me?.user.email ?? creds?.email ?? cliConfig.email ?? null,
      plan: me?.user.plan ?? creds?.userMeta?.plan ?? null,
      keyHint: creds ? maskApiKey(creds.apiKey) : null,
      desktopEncryptedStorePresent: hasDesktopEncryptedCredentials(),
      quota: me?.quota ?? null,
      ...(meError ? { verifyError: meError } : {}),
    },
    proxy,
    apps: {
      connected: connectedApps,
      detected: detectedApps,
      totalSupported: apps.length,
    },
  };

  if (args.json) {
    console.log(JSON.stringify(payload, null, 2));
    return 0;
  }

  const authSummary = payload.auth.authenticated
    ? `${payload.auth.email || 'Connected'} (${payload.auth.plan || payload.auth.source})${payload.auth.keyHint ? ` [${payload.auth.keyHint}]` : ''}`
    : payload.auth.desktopEncryptedStorePresent
      ? 'Desktop credentials detected (Desktop app not hosting proxy; run "torve login" for standalone CLI)'
      : 'Not signed in (run "torve login")';

  const proxySummary = proxy.running
    ? `UP on http://127.0.0.1:${proxy.port} (${proxy.hostedBy === 'desktop' ? 'Torve Desktop' : `CLI PID ${proxy.pid ?? '?'}`}${proxy.authenticated ? '' : ', unauthenticated'})`
    : `STOPPED (127.0.0.1:${proxy.port})`;

  console.log(`Torve CLI v${CLI_VERSION}`);
  console.log(`Account : ${authSummary}`);
  if (me?.quota) {
    const q = me.quota;
    const daily = q.dailyTokenLimit !== null ? `${q.usedTokensToday.toLocaleString('en-US')}/${q.dailyTokenLimit.toLocaleString('en-US')}` : `${q.usedTokensToday.toLocaleString('en-US')} tokens`;
    console.log(`Quota   : ${daily} today (${q.rateLimitStatus})`);
  }
  console.log(`Proxy   : ${proxySummary}`);
  console.log(`Apps    : ${connectedApps.length} connected (${connectedApps.join(', ') || 'none'}), ${detectedApps.length} detected`);
  return 0;
}

export async function runCli(argv: readonly string[]): Promise<number> {
  const args = parseCliArgs(argv);

  if (args.version) {
    if (args.json) console.log(JSON.stringify({ version: CLI_VERSION }));
    else console.log(CLI_VERSION);
    return 0;
  }

  if (args.help || !args.command || args.command === 'help') {
    printHelp(args.command === 'help' ? args.positionals[0] : args.command);
    return 0;
  }

  const cliConfig = await readCliConfig();
  if (!args.portExplicit && cliConfig.port) {
    args.port = cliConfig.port;
  }

  switch (args.command) {
    case 'login': return await cmdLogin(args);
    case 'logout': return await cmdLogout(args);
    case 'apps': return cmdApps(args);
    case 'on': return await cmdOn(args);
    case 'off': return await cmdOff(args);
    case 'start': return await cmdStart(args);
    case 'stop': return await cmdStop(args);
    case 'models': return await cmdModels(args);
    case 'status': return await cmdStatus(args);
    default:
      throw new Error(`Unknown command "${args.command}". Run "torve --help" for usage.`);
  }
}

if (typeof require !== 'undefined' && require.main === module) {
  runCli(process.argv.slice(2)).then(
    (code) => { if (code !== 0) process.exitCode = code; },
    (err) => {
      const msg = err instanceof Error ? err.message : String(err);
      if (process.argv.includes('--json')) {
        console.error(JSON.stringify({ ok: false, error: msg }));
      } else {
        console.error(`Error: ${msg}`);
      }
      process.exitCode = 1;
    },
  );
}
