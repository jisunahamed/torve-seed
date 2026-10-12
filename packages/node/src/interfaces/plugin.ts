import type { Provider } from './seller-provider.js'
import type { Router } from './buyer-router.js'

export interface ConfigField {
  key: string
  label: string
  type: 'string' | 'number' | 'boolean' | 'secret' | 'string[]'
  required?: boolean
  default?: unknown
  description?: string
}

/** @deprecated Use ConfigField instead */
export type PluginConfigKey = ConfigField

export interface TorvePluginBase {
  name: string
  displayName: string
  version: string
  description: string
  configSchema?: ConfigField[]
  /** @deprecated Use configSchema instead */
  configKeys?: ConfigField[]
}

export interface TorveProviderPlugin extends TorvePluginBase {
  type: 'provider'
  createProvider(config: Record<string, string>): Provider | Promise<Provider>
}

export interface TorveRouterPlugin extends TorvePluginBase {
  type: 'router'
  createRouter(config: Record<string, string>): Router | Promise<Router>
}

export interface ClaimResult {
  /** Namespaced claim id, e.g. 'torve-tee/dcap:hardware-genuine'. */
  claim: string
  ok: boolean
  detail?: string
}

export interface VerifyResult {
  /** Overall pass/fail. The buyer applies its own policy (optional vs required). */
  ok: boolean
  claims: ClaimResult[]
}

/** A request the verifier issues to the seller over the existing buyer<->seller comms. */
export interface SellerRequest {
  method: string
  path: string
  headers?: Record<string, string>
  body?: Uint8Array
}

export interface SellerResponse {
  statusCode: number
  headers: Record<string, string>
  body: Uint8Array
}

export interface VerifyContext {
  peerId: string
  /** Verifier id selected by the buyer; must match the SDK name. */
  verifierId: string
  /** Seller prover path for this verifier. */
  attestPath: string
  fetchFromSeller(req: SellerRequest): Promise<SellerResponse>
  signal?: AbortSignal
}

export interface TorveVerifierPlugin extends TorvePluginBase {
  type: 'verifier'
  verify(ctx: VerifyContext): VerifyResult | Promise<VerifyResult>
}

export const TORVE_ATTEST_PATH = '/_torve/attest'

export interface Prover extends TorvePluginBase {
  type: 'prover'
  prove(req: SellerRequest): SellerResponse | Promise<SellerResponse>
}

export type TorvePlugin = TorveProviderPlugin | TorveRouterPlugin | TorveVerifierPlugin | Prover
