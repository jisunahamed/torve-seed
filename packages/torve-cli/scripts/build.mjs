import { existsSync } from 'node:fs';
import { chmod, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageRoot = path.resolve(__dirname, '..');
const distDir = path.join(packageRoot, 'dist');
const entryPoint = path.join(packageRoot, 'src', 'cli.ts');
const outFile = path.join(distDir, 'cli.js');

function resolvePackage(name) {
  const require = createRequire(import.meta.url);
  try {
    return require(name);
  } catch {
    const workspaceRootPkg = path.resolve(packageRoot, '..', '..', 'node_modules', name);
    if (existsSync(workspaceRootPkg)) {
      return require(workspaceRootPkg);
    }
    throw new Error(`Could not resolve ${name} from package or workspace root node_modules.`);
  }
}

async function main() {
  const esbuild = resolvePackage('esbuild');
  const obfuscatorModule = resolvePackage('javascript-obfuscator');
  const obfuscate = obfuscatorModule.obfuscate ?? obfuscatorModule.default?.obfuscate;
  if (typeof obfuscate !== 'function') {
    throw new Error('Could not resolve javascript-obfuscator.obfuscate().');
  }

  await rm(distDir, { recursive: true, force: true });
  await mkdir(distDir, { recursive: true });

  const result = await esbuild.build({
    entryPoints: [entryPoint],
    bundle: true,
    write: false,
    platform: 'node',
    target: 'node20',
    format: 'cjs',
    minify: true,
    sourcemap: false,
    legalComments: 'none',
    external: ['node:*'],
  });

  const bundled = result.outputFiles?.[0]?.text;
  if (!bundled) {
    throw new Error('esbuild produced no output.');
  }

  const obfuscated = obfuscate(bundled, {
    compact: true,
    stringArray: true,
    stringArrayEncoding: ['base64'],
    identifierNamesGenerator: 'hexadecimal',
    controlFlowFlattening: false,
    target: 'node',
  }).getObfuscatedCode();

  const finalCode = `#!/usr/bin/env node\n${obfuscated.replace(/^#![^\n]*\n/, '')}`;
  await writeFile(outFile, finalCode, 'utf8');
  await chmod(outFile, 0o755).catch(() => {});

  // Guard against any stray source map or TypeScript files in dist/.
  const files = await readdir(distDir);
  for (const file of files) {
    if (file.endsWith('.map') || file.endsWith('.ts')) {
      await rm(path.join(distDir, file), { force: true });
    }
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
