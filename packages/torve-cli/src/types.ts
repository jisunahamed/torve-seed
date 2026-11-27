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
  | 'antigravity-ide'
  | 'codex'
  | 'opencode'
  | 'claude-desktop'
  | 'claude-code'
  | 'gemini-cli';

export interface AntigravityConfigPatchDef {
  readonly format: 'antigravity-ide';
  readonly configPath: string;
  readonly baseURL: string;
  readonly mcpConfigPath?: string;
  readonly serverPath?: string;
  readonly mcpFallback?: boolean;
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

export interface ClaudeDesktopConfigPatchDef {
  readonly format: 'claude-desktop';
  readonly configPath: string;
  readonly thirdPartyDir: string;
  readonly baseURL: string;
}

export interface ClaudeCodeConfigPatchDef {
  readonly format: 'claude-code';
  readonly configPath: string;
  readonly providerKey: string;
  readonly baseURL: string;
  readonly models?: readonly OpencodeModelDefinition[];
}

export interface GeminiConfigPatchDef {
  readonly format: 'gemini-cli';
  readonly configPath: string;
  readonly envPath: string;
  readonly baseURL: string;
  readonly model?: string;
}

export type ConfigPatchDef =
  | AntigravityConfigPatchDef
  | CodexConfigPatchDef
  | OpencodeConfigPatchDef
  | ClaudeDesktopConfigPatchDef
  | ClaudeCodeConfigPatchDef
  | GeminiConfigPatchDef;

export interface AppDefinition {
  readonly name: string;
  readonly displayName: string;
  readonly kind: 'config-patch';
  readonly method: string;
  readonly binary?: string;
  readonly detectPaths: readonly string[];
  readonly configPatch: ConfigPatchDef;
}

export interface ComingSoonApp {
  readonly id: string;
  readonly displayName: string;
  readonly aliases?: readonly string[];
}

export interface AppStatusItem {
  name: string;
  displayName: string;
  kind: 'config-patch';
  detected: boolean;
  patched: boolean;
  status: 'ON' | 'OFF';
  configPath: string;
}
