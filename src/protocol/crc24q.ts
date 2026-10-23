/**
 * Qualcomm CRC-24Q implementation as used by RTCM 10403.x (RTCM 3.x) transport layer.
 * Generator polynomial: 0x1864CFB (x^24 + x^23 + x^18 + x^17 + x^14 + x^11 + x^10 + x^7 + x^6 + x^5 + x^4 + x^3 + x + 1).
 */

const CRC24Q_POLY = 0x1864cfb;

const CRC24Q_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let crc = i << 16;
    for (let bit = 0; bit < 8; bit++) {
      crc <<= 1;
      if ((crc & 0x1000000) !== 0) {
        crc ^= CRC24Q_POLY;
      }
    }
    table[i] = crc & 0xffffff;
  }
  return table;
})();

/**
 * Compute 24-bit CRC-24Q over a byte slice.
 */
export function computeCrc24q(bytes: Uint8Array, start = 0, end = bytes.length): number {
  let crc = 0;
  const limit = Math.min(end, bytes.length);
  for (let i = Math.max(0, start); i < limit; i++) {
    const byte = bytes[i] ?? 0;
    const idx = ((crc >>> 16) ^ byte) & 0xff;
    const tableVal = CRC24Q_TABLE[idx] ?? 0;
    crc = ((crc << 8) & 0xffffff) ^ tableVal;
  }
  return crc & 0xffffff;
}

/**
 * Encode bytes as uppercase hexadecimal string.
 */
export function bytesToHex(bytes: Uint8Array): string {
  const parts: string[] = new Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    parts[i] = (bytes[i] ?? 0).toString(16).padStart(2, "0").toUpperCase();
  }
  return parts.join("");
}

/**
 * Parse a hexadecimal string (allowing spaces, colons, or 0x prefixes) into a Uint8Array.
 * Returns null if the input contains non-hex characters or an odd number of hex digits.
 */
export function hexToBytes(hex: string): Uint8Array | null {
  const cleaned = hex.replace(/0x/gi, "").replace(/[\s:,-]+/g, "");
  if (cleaned.length === 0 || cleaned.length % 2 !== 0) {
    return null;
  }
  if (!/^[0-9a-fA-F]+$/.test(cleaned)) {
    return null;
  }
  const out = new Uint8Array(cleaned.length / 2);
  for (let i = 0; i < out.length; i++) {
    const pair = cleaned.slice(i * 2, i * 2 + 2);
    out[i] = Number.parseInt(pair, 16);
  }
  return out;
}

/**
 * Encode bytes to standard Base64 string.
 */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i] ?? 0);
  }
  return btoa(binary);
}

/**
 * Decode standard Base64 string to Uint8Array, or null on invalid input.
 */
export function base64ToBytes(b64: string): Uint8Array | null {
  try {
    const binary = atob(b64.trim());
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      out[i] = binary.charCodeAt(i);
    }
    return out;
  } catch {
    return null;
  }
}
