import assert from 'node:assert/strict'
import { TORVE_MODEL_CONTEXT_WINDOW, TORVE_MODEL_MAX_OUTPUT_TOKENS } from '@torveai/node/types'
import { spawnSync } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  buildCodexConfigArgs,
  buildOpenCodeConfigContent,
  normalizeTorveBaseUrl,
  parseWrappedToolArgs,
  resolveDefaultTorveBaseUrl,
} from './wrapped-tools.js'

const ROOT_PROXY_URL = 'http://localhost:8378'
const V1_PROXY_URL = `${ROOT_PROXY_URL}/v1`
const MODEL_ID = 'deepseek-v4-flash'
const CLI_INDEX = join(dirname(fileURLToPath(import.meta.url)), '..', 'index.js')
const RECORDED_ENV_KEYS = ['ANTHROPIC_BASE_URL', 'ANTHROPIC_API_KEY', 'TORVE_API_KEY', 'OPENCODE_CONFIG'] as const

type OpenCodeConfig = {
  provider: Record<string, {
    options: { baseURL: string }
    models: Record<string, unknown>
  }>
  model: string
}

type ChildCliInvocation = {
  argv: string[]
  env: Record<(typeof RECORDED_ENV_KEYS)[number], string | null>
  opencodeConfig?: OpenCodeConfig
}

type TempWorkspace = {
  binDir: string
  configPath: string
  dataDir: string
}

type RecordingChildCli = {
  readInvocation: () => Promise<ChildCliInvocation>
}

async function withTempWorkspace<T>(fn: (paths: TempWorkspace) => Promise<T>): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), 'torve-wrapper-'))
  try {
    const binDir = join(root, 'bin')
    const dataDir = join(root, 'data')
    await mkdir(binDir)
    await mkdir(dataDir)
    return await fn({ binDir, dataDir, configPath: join(dataDir, 'config.json') })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

async function createRecordingChildCli(workspace: TempWorkspace, executable: string): Promise<RecordingChildCli> {
  const capturePath = join(workspace.dataDir, `${executable}-invocation.json`)
  const envKeys = JSON.stringify(RECORDED_ENV_KEYS)
  const script = `#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';

const envKeys = ${envKeys};
const env = Object.fromEntries(envKeys.map((key) => [key, process.env[key] ?? null]));
const payload = { argv: process.argv.slice(2), env };

if (process.env.OPENCODE_CONFIG) {
  payload.opencodeConfig = JSON.parse(readFileSync(process.env.OPENCODE_CONFIG, 'utf8'));
}

writeFileSync(${JSON.stringify(capturePath)}, JSON.stringify(payload, null, 2));
`
  const executablePath = join(workspace.binDir, executable)
  await writeFile(executablePath, script, 'utf8')
  await chmod(executablePath, 0o755)

  return {
    readInvocation: async () => JSON.parse(await readFile(capturePath, 'utf8')) as ChildCliInvocation,
  }
}

function runWrapper(workspace: TempWorkspace, args: string[]): ReturnType<typeof spawnSync> {
  return spawnSync(
    process.execPath,
    [CLI_INDEX, '--data-dir', workspace.dataDir, '--config', workspace.configPath, ...args],
    {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${workspace.binDir}:${process.env.PATH ?? ''}` },
    },
  )
}

test('parseWrappedToolArgs', async (t) => {
  await t.test('consumes Torve flags and forwards child args', () => {
    const parsed = parseWrappedToolArgs([
      '--model',
      'gpt-oss-120b',
      '--sandbox',
      'workspace-write',
      '--torve-base-url=localhost:8378',
    ])

    assert.equal(parsed.model, 'gpt-oss-120b')
    assert.equal(parsed.torveBaseUrl, 'localhost:8378')
    assert.deepEqual(parsed.childArgs, ['--sandbox', 'workspace-write'])
  })

  await t.test('keeps -- escape hatch for child args', () => {
    const parsed = parseWrappedToolArgs(['--model=foo', '--', '--model', 'child-model'])

    assert.equal(parsed.model, 'foo')
    assert.deepEqual(parsed.childArgs, ['--model', 'child-model'])
  })

  await t.test('rejects unsupported Torve wrapper flags', () => {
    assert.throws(
      () => parseWrappedToolArgs(['--torve-peer', 'peer-id']),
      /--torve-peer is not supported by this wrapper/,
    )
  })
})

test('normalizeTorveBaseUrl', async (t) => {
  await t.test('adds protocol and /v1 to a root URL', () => {
    assert.deepEqual(normalizeTorveBaseUrl('localhost:8377'), {
      root: 'http://localhost:8377',
      v1: 'http://localhost:8377/v1',
    })
  })

  await t.test('derives root from a /v1 URL', () => {
    assert.deepEqual(normalizeTorveBaseUrl('http://localhost:8377/v1'), {
      root: 'http://localhost:8377',
      v1: 'http://localhost:8377/v1',
    })
  })
})

test('resolveDefaultTorveBaseUrl prefers active buyer state over config', async () => {
  await withTempWorkspace(async ({ dataDir, configPath }) => {
    await writeFile(configPath, JSON.stringify({ buyer: { proxyPort: 8390 } }))
    assert.equal(await resolveDefaultTorveBaseUrl(dataDir, configPath), 'http://localhost:8390')

    await writeFile(join(dataDir, 'buyer.state.json'), JSON.stringify({ port: 8378 }))
    assert.equal(await resolveDefaultTorveBaseUrl(dataDir, configPath), 'http://localhost:8378')
  })
})

test('buildCodexConfigArgs uses ephemeral config overrides on the real Codex home', () => {
  const args = buildCodexConfigArgs(V1_PROXY_URL, MODEL_ID)

  assert.equal(args.includes('--profile'), false)
  assert.equal(args.includes('CODEX_HOME'), false)
  assert.ok(args.includes('model_providers.torve.name="Torve"'))
  assert.ok(args.includes(`model_providers.torve.base_url="${V1_PROXY_URL}"`))
  assert.ok(args.includes('model_providers.torve.wire_api="responses"'))
  assert.ok(args.includes('model_providers.torve.env_key="TORVE_API_KEY"'))
  assert.ok(args.includes(`model="${MODEL_ID}"`))
  assert.ok(args.includes('model_provider="torve"'))
  assert.ok(args.includes(`model_context_window=${TORVE_MODEL_CONTEXT_WINDOW}`))
})

test('buildOpenCodeConfigContent configures Torve provider and selected model', () => {
  const model = 'gpt-oss-120b'
  const parsed = JSON.parse(buildOpenCodeConfigContent(V1_PROXY_URL, model)) as OpenCodeConfig

  assert.ok(parsed.provider.torve)
  assert.equal(parsed.provider.torve.options.baseURL, V1_PROXY_URL)
  assert.equal(parsed.model, `torve/${model}`)
  assert.deepEqual(parsed.provider.torve.models[model], {
    name: `${model} (via Torve)`,
    limit: { context: TORVE_MODEL_CONTEXT_WINDOW, output: TORVE_MODEL_MAX_OUTPUT_TOKENS },
  })
})

test('wrapped tool execution', async (t) => {
  await t.test('codex receives Torve config overrides and forwarded child args', async () => {
    await withTempWorkspace(async (workspace) => {
      const codex = await createRecordingChildCli(workspace, 'codex')

      const result = runWrapper(workspace, [
        'codex',
        '--model',
        'minimax-m2.5',
        '--torve-base-url',
        'localhost:8125',
        '--',
        '--version',
      ])
      const invocation = await codex.readInvocation()

      assert.equal(result.status, 0)
      assert.equal(String(result.stderr), '')
      assert.match(String(result.stdout), /Torve proxy: http:\/\/localhost:8125\/v1/)
      assert.ok(invocation.argv.includes('model_provider="torve"'))
      assert.equal(invocation.argv.at(-1), '--version')
      assert.equal(invocation.env.TORVE_API_KEY, 'torve')
    })
  })

  await t.test('claude receives Anthropic proxy env and model args', async () => {
    await withTempWorkspace(async (workspace) => {
      const claude = await createRecordingChildCli(workspace, 'claude')

      const result = runWrapper(workspace, [
        'claude',
        '--model',
        'claude-sonnet',
        '--torve-base-url',
        'localhost:8123/v1',
        '--print',
      ])
      const invocation = await claude.readInvocation()

      assert.equal(result.status, 0)
      assert.equal(String(result.stderr), '')
      assert.match(String(result.stdout), /Torve proxy: http:\/\/localhost:8123/)
      assert.deepEqual(invocation.argv, ['--model', 'claude-sonnet', '--print'])
      assert.equal(invocation.env.ANTHROPIC_BASE_URL, 'http://localhost:8123')
      assert.equal(invocation.env.ANTHROPIC_API_KEY, 'torve')
    })
  })

  await t.test('opencode receives generated config and forwarded child args', async () => {
    await withTempWorkspace(async (workspace) => {
      const opencode = await createRecordingChildCli(workspace, 'opencode')

      const result = runWrapper(workspace, [
        'opencode',
        '--model',
        'gpt-oss-120b',
        '--torve-base-url',
        'http://localhost:8124/v1',
        'run',
      ])
      const invocation = await opencode.readInvocation()
      const torveProvider = invocation.opencodeConfig?.provider.torve

      assert.equal(result.status, 0)
      assert.equal(String(result.stderr), '')
      assert.match(String(result.stdout), /Torve proxy: http:\/\/localhost:8124\/v1/)
      assert.deepEqual(invocation.argv, ['run'])
      assert.equal(invocation.opencodeConfig?.model, 'torve/gpt-oss-120b')
      assert.ok(torveProvider)
      assert.equal(torveProvider.options.baseURL, 'http://localhost:8124/v1')
      assert.ok(torveProvider.models['gpt-oss-120b'])
    })
  })
})
