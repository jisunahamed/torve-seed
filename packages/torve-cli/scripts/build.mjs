import { existsSync } from 'node:fs';
import { mkdir, readdir, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageRoot = path.resolve(__dirname, '..');
const distDir = path.join(packageRoot, 'dist');
const entryPoint = path.join(packageRoot, 'src', 'cli.ts');
const outFile = path.join(distDir, 'cli.js');

function resolveEsbuild() {
  const require = createRequire(import.meta.url);
  try {
    return require('esbuild');
  } catch {
    const workspaceRootEsbuild = path.resolve(packageRoot, '..', '..', 'node_modules', 'esbuild');
    if (existsSync(workspaceRootEsbuild)) {
      return require(workspaceRootEsbuild);
    }
    throw new Error('Could not resolve esbuild from package or workspace root node_modules.');
  }
}

async function main() {
  const esbuild = resolveEsbuild();
  await rm(distDir, { recursive: true, force: true });
  await mkdir(distDir, { recursive: true });

  await esbuild.build({
    entryPoints: [entryPoint],
    outfile: outFile,
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'cjs',
    minify: true,
    sourcemap: false,
    legalComments: 'none',
    banner: {
      js: '#!/usr/bin/env node',
    },
    external: ['node:*'],
  });

  // Guard against any stray source map files in dist/.
  const files = await readdir(distDir);
  for (const file of files) {
    if (file.endsWith('.map')) {
      await rm(path.join(distDir, file), { force: true });
    }
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
