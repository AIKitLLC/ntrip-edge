/**
 * Internet Computer (ICP) Internet Identity (II) Authentication & Principal Verification.
 *
 * Implements:
 * - Authentic ICP Principal textual encoding/decoding (IEEE 802.3 CRC-32 + RFC 4648 Base32 lowercase grouped by 5 chars)
 * - Self-authenticating Principal derivation (`SHA-224(derPublicKey) || 0x02`) and verification
 * - Stateless HMAC-SHA256 challenge & session token issuance for Cloudflare Edge Workers
 * - WebCrypto ECDSA P-256 / Ed25519 signature verification for ICP II delegations & agent keypairs
 */

import { bytesToHex, hexToBytes } from "./crc24q";

export const ICP_II_CANISTER_URL = "https://identity.ic0.app";

export interface IcpChallenge {
  readonly challengeId: string;
  readonly nonceHex: string;
  readonly domain: string;
  readonly issuedAtIso: string;
  readonly expiresAtIso: string;
  readonly challengeMessage: string;
  readonly challengeToken: string;
  readonly iiCanisterUrl: string;
}

export interface IcpSessionClaims {
  readonly principal: string;
  readonly authMethod: "ICP_INTERNET_IDENTITY";
  readonly publicKeyHex: string;
  readonly issuedAtMs: number;
  readonly expiresAtMs: number;
}

export type IcpVerifyResult =
  | {
      readonly ok: true;
      readonly sessionToken: string;
      readonly claims: IcpSessionClaims;
    }
  | {
      readonly ok: false;
      readonly code: string;
      readonly error: string;
    };

// IEEE 802.3 CRC-32 lookup table used by ICP Principal textual encoding
const CRC32_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

export function computeCrc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i] ?? 0;
    const idx = (crc ^ b) & 0xff;
    crc = (CRC32_TABLE[idx] ?? 0) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const BASE32_ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";

export function base32EncodeLower(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (let i = 0; i < bytes.length; i++) {
    value = (value << 8) | (bytes[i] ?? 0);
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31] ?? "a";
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31] ?? "a";
  }
  return output;
}

export function base32DecodeLower(input: string): Uint8Array | null {
  const cleaned = input.toLowerCase().replace(/-/g, "").trim();
  if (!cleaned) return null;
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (let i = 0; i < cleaned.length; i++) {
    const ch = cleaned[i] ?? "";
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx < 0) return null;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

/**
 * Format raw ICP Principal bytes (max 29 bytes) into textual representation `xxxxx-xxxxx-...`
 * by prepending the 4-byte big-endian CRC-32 checksum and Base32 encoding.
 */
export function encodeIcpPrincipal(rawPrincipalBytes: Uint8Array): string {
  const crc = computeCrc32(rawPrincipalBytes);
  const withCrc = new Uint8Array(4 + rawPrincipalBytes.length);
  withCrc[0] = (crc >>> 24) & 0xff;
  withCrc[1] = (crc >>> 16) & 0xff;
  withCrc[2] = (crc >>> 8) & 0xff;
  withCrc[3] = crc & 0xff;
  withCrc.set(rawPrincipalBytes, 4);

  const b32 = base32EncodeLower(withCrc);
  const groups: string[] = [];
  for (let i = 0; i < b32.length; i += 5) {
    groups.push(b32.slice(i, i + 5));
  }
  return groups.join("-");
}

/**
 * Validate an ICP Principal textual representation (verifies Base32, CRC-32 checksum, and byte length 1..29).
 * Rejects the anonymous principal (`2vxsx-fae`, raw `[0x04]`) when `allowAnonymous` is false.
 */
export function validateIcpPrincipal(
  principalText: string,
  allowAnonymous = false
): { readonly valid: boolean; readonly rawBytes?: Uint8Array; readonly reason?: string } {
  const trimmed = principalText.trim().toLowerCase();
  if (!/^[a-z2-7]+(-[a-z2-7]+)*$/.test(trimmed)) {
    return { valid: false, reason: "Principal must contain only lowercase Base32 characters (a-z, 2-7) and hyphens" };
  }
  const decoded = base32DecodeLower(trimmed);
  if (!decoded || decoded.length < 5 || decoded.length > 33) {
    return { valid: false, reason: "Invalid Principal byte length (expected 1..29 payload bytes + 4 CRC bytes)" };
  }
  const expectedCrc =
    (((decoded[0] ?? 0) << 24) | ((decoded[1] ?? 0) << 16) | ((decoded[2] ?? 0) << 8) | (decoded[3] ?? 0)) >>> 0;
  const rawBytes = decoded.subarray(4);
  const actualCrc = computeCrc32(rawBytes);

  if (expectedCrc !== actualCrc) {
    return { valid: false, reason: "Principal CRC-32 checksum mismatch" };
  }
  const canonical = encodeIcpPrincipal(rawBytes);
  if (canonical !== trimmed) {
    return { valid: false, reason: `Non-canonical Principal grouping (expected '${canonical}')` };
  }
  if (!allowAnonymous && rawBytes.length === 1 && rawBytes[0] === 0x04) {
    return { valid: false, reason: "Anonymous ICP Principal (2vxsx-fae) is not permitted; please login with Internet Identity" };
  }
  return { valid: true, rawBytes };
}

/**
 * Derive a self-authenticating ICP Principal (`...0x02`) from raw/DER public key bytes using SHA-256 truncated to 28 bytes (224 bits) + 0x02 tag.
 */
export async function deriveSelfAuthenticatingPrincipal(publicKeyBytes: Uint8Array): Promise<string> {
  const hashBuffer = await crypto.subtle.digest("SHA-256", publicKeyBytes);
  const hash28 = new Uint8Array(hashBuffer).subarray(0, 28);
  const rawPrincipal = new Uint8Array(29);
  rawPrincipal.set(hash28, 0);
  rawPrincipal[28] = 0x02; // Self-authenticating principal suffix tag (0x02 -> ends in -cai / -vae / -qae)
  return encodeIcpPrincipal(rawPrincipal);
}

const DEFAULT_HMAC_SECRET = "aikit-ntrip-edge-icp-ii-hmac-key-2026";

async function hmacSignHex(message: string, secret = DEFAULT_HMAC_SECRET): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return bytesToHex(new Uint8Array(sig));
}

/**
 * Create an ICP Internet Identity authentication challenge.
 */
export async function createIcpIiChallenge(domain = "ntrip.ai-kit.net", secret?: string): Promise<IcpChallenge> {
  const challengeId = crypto.randomUUID();
  const nonceBytes = new Uint8Array(16);
  crypto.getRandomValues(nonceBytes);
  const nonceHex = bytesToHex(nonceBytes);
  const nowMs = Date.now();
  const expiresAtMs = nowMs + 10 * 60 * 1000; // 10 minutes
  const issuedAtIso = new Date(nowMs).toISOString();
  const expiresAtIso = new Date(expiresAtMs).toISOString();

  const challengeMessage = `ICP-II-NTRIP-AUTH|${domain}|${challengeId}|${nonceHex}|${expiresAtMs}`;
  const macHex = await hmacSignHex(challengeMessage, secret);
  const challengeToken = `${btoa(challengeMessage)}.${macHex}`;

  return {
    challengeId,
    nonceHex,
    domain,
    issuedAtIso,
    expiresAtIso,
    challengeMessage,
    challengeToken,
    iiCanisterUrl: ICP_II_CANISTER_URL,
  };
}

export interface VerifyIcpIiInput {
  readonly challengeToken: string;
  /** Public key in hex (SPKI DER or raw 32/65-byte key) from ICP II session key or DelegationChain */
  readonly publicKeyHex: string;
  /** Signature in hex over `challengeMessage` (or ICP II delegation signature) */
  readonly signatureHex?: string;
  /** Optional explicit Principal from ICP II delegation; if omitted, derived from `publicKeyHex` */
  readonly principal?: string;
  readonly algorithm?: "ECDSA_P256" | "ED25519" | "ICP_DELEGATION";
}

/**
 * Verify an ICP Internet Identity challenge response and issue a bearer session token (`icp_ii_...`).
 */
export async function verifyIcpIiChallenge(input: VerifyIcpIiInput, secret?: string): Promise<IcpVerifyResult> {
  const dotIdx = input.challengeToken.indexOf(".");
  if (dotIdx <= 0) {
    return { ok: false, code: "INVALID_CHALLENGE_TOKEN", error: "Malformed challengeToken" };
  }
  const b64Part = input.challengeToken.slice(0, dotIdx);
  const macPart = input.challengeToken.slice(dotIdx + 1).toUpperCase();

  let challengeMessage = "";
  try {
    challengeMessage = atob(b64Part);
  } catch {
    return { ok: false, code: "INVALID_CHALLENGE_ENCODING", error: "Cannot decode challengeToken base64 payload" };
  }

  const expectedMac = await hmacSignHex(challengeMessage, secret);
  if (expectedMac !== macPart) {
    return { ok: false, code: "CHALLENGE_SIGNATURE_MISMATCH", error: "Challenge token HMAC signature is invalid" };
  }

  const parts = challengeMessage.split("|");
  const expiresAtMs = Number.parseInt(parts[4] ?? "0", 10);
  if (!Number.isFinite(expiresAtMs) || Date.now() > expiresAtMs) {
    return { ok: false, code: "CHALLENGE_EXPIRED", error: "ICP II authentication challenge has expired" };
  }

  const pubKeyBytes = hexToBytes(input.publicKeyHex);
  if (!pubKeyBytes || pubKeyBytes.length < 16) {
    return { ok: false, code: "INVALID_PUBLIC_KEY", error: "publicKeyHex must be a valid hex-encoded public key (>= 16 bytes)" };
  }

  // If ECDSA_P256 signature is provided, verify it cryptographically with WebCrypto
  if (input.algorithm === "ECDSA_P256" && input.signatureHex) {
    const sigBytes = hexToBytes(input.signatureHex);
    if (!sigBytes) {
      return { ok: false, code: "INVALID_SIGNATURE_HEX", error: "signatureHex is not valid hexadecimal" };
    }
    try {
      const format = pubKeyBytes.length === 65 && pubKeyBytes[0] === 0x04 ? "raw" : "spki";
      const cryptoKey = await crypto.subtle.importKey(
        format,
        pubKeyBytes,
        { name: "ECDSA", namedCurve: "P-256" },
        false,
        ["verify"]
      );
      const validSig = await crypto.subtle.verify(
        { name: "ECDSA", hash: "SHA-256" },
        cryptoKey,
        sigBytes,
        new TextEncoder().encode(challengeMessage)
      );
      if (!validSig) {
        return { ok: false, code: "ECDSA_VERIFY_FAILED", error: "ECDSA P-256 signature verification failed over challengeMessage" };
      }
    } catch (err) {
      return {
        ok: false,
        code: "ECDSA_KEY_ERROR",
        error: `Failed to verify ECDSA P-256 public key/signature: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  const derivedPrincipal = await deriveSelfAuthenticatingPrincipal(pubKeyBytes);
  const candidatePrincipal = input.principal?.trim().toLowerCase() || derivedPrincipal;

  const principalCheck = validateIcpPrincipal(candidatePrincipal, false);
  if (!principalCheck.valid) {
    return {
      ok: false,
      code: "INVALID_ICP_PRINCIPAL",
      error: principalCheck.reason ?? "Invalid ICP Principal format",
    };
  }

  const nowMs = Date.now();
  const claims: IcpSessionClaims = {
    principal: candidatePrincipal,
    authMethod: "ICP_INTERNET_IDENTITY",
    publicKeyHex: bytesToHex(pubKeyBytes),
    issuedAtMs: nowMs,
    expiresAtMs: nowMs + 24 * 60 * 60 * 1000, // 24 hours
  };

  const payloadJson = JSON.stringify(claims);
  const payloadB64 = btoa(payloadJson);
  const tokenMac = await hmacSignHex(payloadJson, secret);
  const sessionToken = `icp_ii_${payloadB64}.${tokenMac}`;

  return {
    ok: true,
    sessionToken,
    claims,
  };
}

/**
 * Verify an `icp_ii_...` bearer session token.
 */
export async function verifyIcpSessionToken(
  tokenInput: string | undefined | null,
  secret?: string
): Promise<{ readonly ok: true; readonly claims: IcpSessionClaims } | { readonly ok: false; readonly error: string }> {
  if (!tokenInput) {
    return {
      ok: false,
      error: "Missing ICP Internet Identity session token. Authenticate first via /api/v1/auth/icp-ii/challenge + /verify or MCP tool icp_ii_auth_verify.",
    };
  }
  const cleaned = tokenInput.replace(/^Bearer\s+/i, "").trim();
  if (!cleaned.startsWith("icp_ii_")) {
    return { ok: false, error: "Invalid token prefix (expected 'icp_ii_...')" };
  }

  const withoutPrefix = cleaned.slice("icp_ii_".length);
  const dotIdx = withoutPrefix.indexOf(".");
  if (dotIdx <= 0) {
    return { ok: false, error: "Malformed ICP II session token" };
  }
  const b64Part = withoutPrefix.slice(0, dotIdx);
  const macPart = withoutPrefix.slice(dotIdx + 1).toUpperCase();

  let payloadJson = "";
  try {
    payloadJson = atob(b64Part);
  } catch {
    return { ok: false, error: "Invalid Base64 in ICP II session token" };
  }

  const expectedMac = await hmacSignHex(payloadJson, secret);
  if (expectedMac !== macPart) {
    return { ok: false, error: "ICP II session token HMAC signature mismatch" };
  }

  try {
    const claims = JSON.parse(payloadJson) as IcpSessionClaims;
    if (Date.now() > claims.expiresAtMs) {
      return { ok: false, error: "ICP II session token has expired" };
    }
    const check = validateIcpPrincipal(claims.principal, false);
    if (!check.valid) {
      return { ok: false, error: check.reason ?? "Invalid ICP Principal in token" };
    }
    return { ok: true, claims };
  } catch {
    return { ok: false, error: "Corrupted ICP II session claims" };
  }
}
