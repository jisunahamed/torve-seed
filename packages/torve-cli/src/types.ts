export type AuthMode = 'oauth' | 'manual';

export interface TorveKeyMeta {
  id: string | null;
  name: string | null;
  prefix: string | null;
  createdAt: string | null;
}

export interface TorveUserMeta {
  id: string | null;
  email: string | null;
  name: string | null;
  plan: string | null;
  status: string | null;
}

export interface TorveQuotaSummary {
  usedTokensToday: number;
  usedRequestsToday: number;
  dailyTokenLimit: number | null;
  dailyRequestLimit: number | null;
  rateLimitStatus: string;
  resetsAt: string | null;
  monthlyUsedTokens: number | null;
  monthlyAllowanceTokens: number | null;
  monthlyUsedRequests: number | null;
  monthlyAllowanceRequests: number | null;
}

export interface DesktopMeResponse {
  user: TorveUserMeta;
  key: TorveKeyMeta;
  quota: TorveQuotaSummary;
}

export interface CliConfig {
  version: 1;
  apiKey?: string;
  authMode?: AuthMode;
  email?: string | null;
  keyMeta?: TorveKeyMeta | null;
  userMeta?: TorveUserMeta | null;
  port?: number;
  webBaseUrl?: string;
  apiBaseUrl?: string;
  updatedAt?: number;
}

export interface ProxyPidInfo {
  pid: number;
  port: number;
  startedAt: number;
  upstream: string;
}

export interface TorveModel {
  id: string;
  object?: string;
  owned_by?: string;
  [key: string]: unknown;
}

export interface ModelsCache {
  updatedAt: number;
  models: TorveModel[];
}

export interface OpencodeModelDefinition {
  readonly id: string;
  readonly name: string;
  readonly context?: number;
  readonly output?: number;
  readonly vision?: boolean;
}

export type ConfigPatchFormat =
  | 'opencode'
  | 'codex'
  | 'claude-code'
  | 'claude-desktop'
  | 'gemini-cli'
  | 'antigravity-ide'
  | 'aider'
  | 'continue'
  | 'hermes'
  | 'droid'
  | 't3code'
  | 'pi'
  | 'crush'
  | 'goose'
  | 'zed';

export interface OpencodeConfigPatchDef {
  readonly format: 'opencode';
  readonly configPath: string;
  readonly providerKey: string;
  readonly npm: string;
  readonly providerName: string;
  readonly baseURL: string;
  readonly models?: readonly OpencodeModelDefinition[];
  readonly modelAlias?: string;
  readonly apiKey?: string;
}

export interface CodexConfigPatchDef {
  readonly format: 'codex';
  readonly configPath: string;
  readonly providerKey: string;
  readonly providerName: string;
  readonly baseURL: string;
  readonly model?: string;
  readonly modelCatalogJson?: string;
  readonly bearerToken?: string;
}

export interface ClaudeCodeConfigPatchDef {
  readonly format: 'claude-code';
  readonly configPath: string;
  readonly providerKey: string;
  readonly baseURL: string;
  readonly models?: readonly OpencodeModelDefinition[];
}

export interface ClaudeDesktopConfigPatchDef {
  readonly format: 'claude-desktop';
  readonly configPath: string;
  readonly thirdPartyDir: string;
  readonly baseURL: string;
}

export interface GeminiConfigPatchDef {
  readonly format: 'gemini-cli';
  readonly configPath: string;
  readonly envPath: string;
  readonly baseURL: string;
  readonly model?: string;
}

export interface AntigravityConfigPatchDef {
  readonly format: 'antigravity-ide';
  readonly configPath: string;
  readonly baseURL: string;
  readonly mcpConfigPath?: string;
  readonly serverPath?: string;
  readonly mcpFallback?: boolean;
}

export interface AiderConfigPatchDef {
  readonly format: 'aider';
  readonly configPath: string;
  readonly baseURL: string;
}

export interface ContinueConfigPatchDef {
  readonly format: 'continue';
  readonly configPath: string;
  readonly legacyConfigPath?: string;
  readonly baseURL: string;
  readonly models?: readonly OpencodeModelDefinition[];
}

export interface HermesConfigPatchDef {
  readonly format: 'hermes';
  readonly configPath: string;
  readonly providerKey: string;
  readonly baseURL: string;
}

export interface DroidConfigPatchDef {
  readonly format: 'droid';
  readonly configPath: string;
  readonly providerKey: string;
  readonly providerName: string;
  readonly baseURL: string;
  readonly originator?: string;
}

export interface T3CodeConfigPatchDef {
  readonly format: 't3code';
  readonly configPath: string;
  readonly providerKey: string;
  readonly providerName: string;
  readonly baseURL: string;
}

export interface PiConfigPatchDef {
  readonly format: 'pi';
  readonly configPath: string;
  readonly settingsPath: string;
  readonly providerKey: string;
  readonly baseURL: string;
  readonly api: 'openai-completions' | 'openai-responses' | 'anthropic-messages';
  readonly originator?: string;
}

export interface CrushConfigPatchDef {
  readonly format: 'crush';
  readonly configPath: string;
  readonly providerKey: string;
  readonly providerName: string;
  readonly baseURL: string;
}

export interface GooseConfigPatchDef {
  readonly format: 'goose';
  readonly configPath: string;
  readonly providerKey: string;
  readonly baseURL: string;
}

export interface ZedConfigPatchDef {
  readonly format: 'zed';
  readonly configPath: string;
  readonly providerKey: string;
  readonly providerName: string;
  readonly baseURL: string;
}

export type ConfigPatchDef =
  | OpencodeConfigPatchDef
  | CodexConfigPatchDef
  | ClaudeCodeConfigPatchDef
  | ClaudeDesktopConfigPatchDef
  | GeminiConfigPatchDef
  | AntigravityConfigPatchDef
  | AiderConfigPatchDef
  | ContinueConfigPatchDef
  | HermesConfigPatchDef
  | DroidConfigPatchDef
  | T3CodeConfigPatchDef
  | PiConfigPatchDef
  | CrushConfigPatchDef
  | GooseConfigPatchDef
  | ZedConfigPatchDef;

export interface AppDefinition {
  readonly name: string;
  readonly displayName: string;
  readonly kind: 'config-patch' | 'manual';
  readonly method: string;
  readonly binary?: string;
  readonly detectPaths: readonly string[];
  readonly configPatch?: ConfigPatchDef;
  readonly manualInstructions?: (port: number) => string;
}

export interface AppStatusItem {
  name: string;
  displayName: string;
  kind: 'config-patch' | 'manual';
  detected: boolean;
  patched: boolean;
  status: 'ON' | 'OFF' | 'MANUAL';
  configPath: string;
}
