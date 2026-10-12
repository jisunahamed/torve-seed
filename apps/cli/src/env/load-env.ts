import dotenv from 'dotenv';
import { resolve } from 'node:path';

function applyEnvFile(filePath: string): void {
  dotenv.config({ path: filePath, override: false });
}

/**
 * Load runtime environment variables from .env files.
 * Precedence: existing process.env > explicit env file > .env.local > .env
 */
export function loadEnvFromFiles(): void {
  const explicit = process.env['TORVE_ENV_FILE'];
  if (explicit) {
    applyEnvFile(resolve(explicit));
  }

  applyEnvFile(resolve(process.cwd(), '.env.local'));
  applyEnvFile(resolve(process.cwd(), '.env'));
}
