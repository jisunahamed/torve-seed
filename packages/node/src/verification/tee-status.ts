export const TEE_VERIFIER_ID = 'torve-verifier'
export const TEE_MAX_AGE_MS = 5 * 60_000
export const TEE_BADGE_MAX_AGE_MS = 24 * 60 * 60_000
export const TEE_REQUIRED_CLAIMS = [
  'torve-verifier:seller-node-tee-genuine',
  'torve-verifier:seller-bound',
] as const

export interface TeeClaim {
  claim: string
  ok: boolean
  detail?: string
}
export interface TeeEvidence {
  peerId: string
  verifierId: string
  verifierVersion?: string
  fingerprint: string
  checkedAt: number
  expiresAt: number
  sellerNodeVerified: boolean
  claims: TeeClaim[]
  reason?: string
  checking?: boolean
  unavailable?: boolean
}
export interface TeeSnapshot {
  sessionId: string
  verificationEnabled: boolean
  evidence: TeeEvidence[]
}
export interface DesktopTeeStatus {
  snapshot: TeeSnapshot | null
  error?: string
}

export function passedSellerNodeClaims(claims: readonly TeeClaim[]): boolean {
  return TEE_REQUIRED_CLAIMS.every((required) => {
    const matches = claims.filter((claim) => claim.claim === required)
    return matches.length > 0 && matches.every((claim) => claim.ok === true)
  })
}

export function isFreshSellerNodeEvidence(evidence: TeeEvidence | undefined, now = Date.now()): boolean {
  return evidence?.sellerNodeVerified === true && !evidence.checking
    && !evidence.unavailable && evidence.expiresAt > now
}

export function teeControlFileName(port: number): string {
  return `buyer-verification-${port}.json`
}
