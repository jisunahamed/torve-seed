import type { Command } from 'commander';
import chalk from 'chalk';
import { getGlobalOptions } from '../types.js';
import { clearCredentials, loadCredentials } from '../../../auth/credentials.js';
import { runDeviceFlow } from '../../../auth/device-flow.js';

export function registerAuthCommands(program: Command): void {
  const authCmd = program
    .command('auth')
    .description('Authenticate with Torve (API key login)');

  authCmd
    .command('login')
    .description('Log in to Torve (opens browser, then paste your API key)')
    .option('--no-open', 'do not automatically open the browser')
    .action(async (options: { open: boolean }) => {
      const globalOpts = getGlobalOptions(program);
      await runDeviceFlow({ dataDir: globalOpts.dataDir, openBrowser: options.open });
    });

  authCmd
    .command('logout')
    .description('Log out and remove stored credentials')
    .action(async () => {
      const globalOpts = getGlobalOptions(program);
      const removed = await clearCredentials(globalOpts.dataDir);
      if (removed) {
        console.log(chalk.green('Logged out. Credentials removed.'));
      } else {
        console.log(chalk.yellow('Not logged in — no credentials to remove.'));
      }
    });

  authCmd
    .command('status')
    .description('Show current login status')
    .action(async () => {
      const globalOpts = getGlobalOptions(program);
      const creds = await loadCredentials(globalOpts.dataDir);
      if (!creds) {
        console.log(chalk.yellow('Not logged in.'));
        console.log(chalk.dim(`Run: ${chalk.bold('torve auth login')}`));
        return;
      }
      console.log(chalk.green('Logged in.'));
      if (creds.email) {
        console.log(`  Account: ${creds.email}`);
      }
      if (creds.userId) {
        console.log(chalk.dim(`  User ID: ${creds.userId}`));
      }
      console.log(chalk.dim(`  Saved: ${creds.savedAt}`));
      console.log(chalk.dim(`  File: ${globalOpts.dataDir}/credentials.json`));
      // Don't print the key itself; show prefix hint
      const hint = creds.apiKey.length > 12
        ? `${creds.apiKey.slice(0, 8)}…${creds.apiKey.slice(-4)}`
        : '••••••••';
      console.log(chalk.dim(`  API key: ${hint}`));
    });
}
