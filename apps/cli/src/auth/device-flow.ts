import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import chalk from 'chalk';
import open from 'open';
import { randomBytes } from 'node:crypto';
import { loadCredentials, saveCredentials } from './credentials.js';

const WEB_ORIGIN = process.env.TORVE_WEB_ORIGIN
  || process.env.WEB_PUBLIC_ORIGIN
  || 'https://torveai.com';

function generateDeviceCode(): string {
  // 8-char human-readable code like XXXX-XXXX (base32-ish)
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(8);
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += alphabet[bytes[i]! % alphabet.length]!;
  }
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

function generateApiKeyHint(): string {
  // Not an actual key — just a device code for display
  return generateDeviceCode();
}

async function promptForApiKey(): Promise<string | null> {
  const rl = createInterface({ input, output });
  try {
    const answer = await rl.question(chalk.dim('Paste API key (or press Enter to skip): '));
    const trimmed = answer.trim();
    if (trimmed.length === 0) return null;
    // Strip "Bearer " prefix if user pastes full header
    if (trimmed.toLowerCase().startsWith('bearer ')) {
      return trimmed.slice(7).trim();
    }
    return trimmed;
  } finally {
    rl.close();
  }
}

function buildAuthorizeUrl(deviceCode: string): string {
  // Prefer the authorize page; fall back to login/dashboard if not yet deployed.
  // The website team can implement /cli/authorize to consume ?device_code=
  const base = WEB_ORIGIN.replace(/\/$/, '');
  // Use /cli/authorize if available; otherwise redirect to login with next hint
  return `${base}/cli/authorize?device_code=${encodeURIComponent(deviceCode)}`;
}

function buildDashboardUrl(): string {
  const base = WEB_ORIGIN.replace(/\/$/, '');
  return `${base}/dashboard`;
}

export interface DeviceFlowOptions {
  dataDir: string;
  openBrowser?: boolean;
}

export async function runDeviceFlow(opts: DeviceFlowOptions): Promise<void> {
  const { dataDir, openBrowser: shouldOpen = true } = opts;

  // If already logged in, tell user
  const existing = await loadCredentials(dataDir);
  if (existing) {
    console.log(chalk.yellow(`Already logged in${existing.email ? ` as ${existing.email}` : ''}.`));
    console.log(chalk.dim(`Credentials: ${dataDir}/credentials.json`));
    console.log(chalk.dim('Run `torve auth logout` first to switch accounts, or paste a new key to overwrite.'));
  }

  const deviceCode = generateApiKeyHint();
  const authorizeUrl = buildAuthorizeUrl(deviceCode);
  const dashboardUrl = buildDashboardUrl();

  console.log('');
  console.log(chalk.bold('  torve auth login'));
  console.log('');
  console.log(chalk.dim('  Device code: ') + chalk.bold.cyan(deviceCode));
  console.log('');
  console.log(chalk.dim('  1. Open this URL in your browser:'));
  console.log(`     ${chalk.cyan(authorizeUrl)}`);
  console.log('');
  console.log(chalk.dim('  2. Sign in to Torve (Google or email) if prompted.'));
  console.log(chalk.dim('  3. Go to Dashboard → API Keys and copy your API key.'));
  console.log(chalk.dim(`     ${dashboardUrl}`));
  console.log('');

  if (shouldOpen) {
    try {
      // Try to open the authorize URL; if it 404s the dashboard is still useful
      await open(authorizeUrl);
      console.log(chalk.dim('  (Browser opened automatically — if nothing happened, copy the URL above.)'));
      console.log('');
    } catch {
      console.log(chalk.dim('  (Could not open browser automatically — please copy the URL above.)'));
      console.log('');
    }
  } else {
    console.log(chalk.dim('  (--no-open: browser not opened automatically)'));
    console.log('');
  }

  // Poll for browser completion is not wired yet (needs website /cli/authorize endpoint).
  // v1 flow: ask user to paste API key directly.
  console.log(chalk.dim('  ────────────────────────────────────────────'));
  const apiKey = await promptForApiKey();

  if (!apiKey) {
    console.log('');
    console.log(chalk.yellow('No API key entered. Login cancelled.'));
    console.log(chalk.dim(`You can also set it manually: echo '{"apiKey":"..."}' > ${dataDir}/credentials.json`));
    console.log(chalk.dim(`Or run again: ${chalk.bold('torve auth login')}`));
    return;
  }

  // Basic validation
  if (apiKey.length < 8) {
    console.error(chalk.red('API key looks too short — not saved. Please try again.'));
    process.exitCode = 1;
    return;
  }

  // Try to infer email from JWT if the key is a Supabase JWT (contains payload)
  let email: string | undefined;
  let userId: string | undefined;
  try {
    const parts = apiKey.split('.');
    if (parts.length === 3) {
      const payloadJson = Buffer.from(parts[1]!, 'base64url').toString('utf-8');
      const payload = JSON.parse(payloadJson) as Record<string, unknown>;
      if (typeof payload['email'] === 'string') email = String(payload['email']);
      if (typeof payload['sub'] === 'string') userId = String(payload['sub']);
    }
  } catch {
    // Not a JWT — treat as opaque API key
  }

  await saveCredentials(dataDir, {
    apiKey,
    ...(email ? { email } : {}),
    ...(userId ? { userId } : {}),
    savedAt: new Date().toISOString(),
  });

  console.log('');
  console.log(chalk.green('✓ Logged in successfully!'));
  if (email) {
    console.log(chalk.dim(`  Account: ${email}`));
  }
  console.log(chalk.dim(`  Credentials saved to ${dataDir}/credentials.json`));
  console.log('');
  console.log(chalk.dim(`  Next steps:`));
  console.log(chalk.dim(`    torve auth status          — verify login`));
  console.log(chalk.dim(`    torve codex --model <id>   — run Codex via Torve proxy`));
  console.log(chalk.dim(`    torve claude --model <id>  — run Claude Code via Torve proxy`));
}
