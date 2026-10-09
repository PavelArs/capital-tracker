import { createHash } from 'node:crypto';
import { base58Bytes } from './solana-address';

// TOKEN-ANY (M25): an SPL token's name and symbol are not in its transfers. A classic token
// keeps them in its Metaplex metadata account, whose address follows from the mint; a
// Token-2022 mint may carry them itself. Both are read with getMultipleAccounts.

export const METADATA_PROGRAM = 'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s';
export const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export const TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
/** Wrapped SOL calls itself "SOL"; it is named apart from the network's own coin. */
export const WRAPPED_SOL = 'So11111111111111111111111111111111111111112';

const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/** The base58 text of bytes; each leading zero byte is a "1". */
export function base58Text(bytes: Uint8Array): string {
  let number = 0n;
  for (const byte of bytes) number = number * 256n + BigInt(byte);
  let text = '';
  while (number > 0n) {
    text = BASE58[Number(number % 58n)] + text;
    number /= 58n;
  }
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  return '1'.repeat(zeros) + text;
}

// Ed25519 over p = 2^255 - 19 with d = -121665/121666: a program address must not be a point
// of the curve, so no key can sign for it.
const P = 2n ** 255n - 19n;
function power(base: bigint, exponent: bigint): bigint {
  let result = 1n;
  let value = base % P;
  for (let rest = exponent; rest > 0n; rest >>= 1n) {
    if (rest & 1n) result = (result * value) % P;
    value = (value * value) % P;
  }
  return result;
}
const inverse = (value: bigint) => power(value, P - 2n);
const D = (((-121665n * inverse(121666n)) % P) + P) % P;

/** Whether 32 bytes decompress to a point of the curve, as Solana decides it. */
export function isOnCurve(bytes: Uint8Array): boolean {
  let y = 0n;
  for (let index = 31; index >= 0; index--) y = (y << 8n) | BigInt(bytes[index]);
  y = (y & ((1n << 255n) - 1n)) % P;
  const square = (y * y) % P;
  const u = (square - 1n + P) % P;
  const v = (D * square + 1n) % P;
  const ratio = (u * inverse(v)) % P;
  return ratio === 0n || power(ratio, (P - 1n) / 2n) === 1n;
}

/** The program address of the seeds: the first bump from 255 down that is off the curve. */
export function programAddress(seeds: readonly Uint8Array[], program: string): string {
  const programBytes = base58Bytes(program);
  if (programBytes?.length !== 32) throw new Error('Invalid program');
  for (let bump = 255; bump >= 0; bump--) {
    const hash = createHash('sha256');
    for (const seed of seeds) hash.update(seed);
    hash.update(Uint8Array.of(bump));
    hash.update(programBytes);
    hash.update('ProgramDerivedAddress');
    const digest = hash.digest();
    if (!isOnCurve(digest)) return base58Text(digest);
  }
  throw new Error('No program address');
}

/** The Metaplex metadata account of a mint. */
export function metadataAddress(mint: string): string {
  const mintBytes = base58Bytes(mint);
  const programBytes = base58Bytes(METADATA_PROGRAM);
  if (mintBytes?.length !== 32 || !programBytes) throw new Error('Invalid mint');
  return programAddress([Buffer.from('metadata'), programBytes, mintBytes], METADATA_PROGRAM);
}

export interface TokenNames {
  name: string | null;
  symbol: string | null;
}

function borshString(data: Buffer, offset: number): { text: string; next: number } | null {
  if (offset + 4 > data.length) return null;
  const length = data.readUInt32LE(offset);
  if (length > 200 || offset + 4 + length > data.length) return null;
  const text = data
    .subarray(offset + 4, offset + 4 + length)
    .toString('utf8')
    .replace(/\0+$/, '');
  return { text, next: offset + 4 + length };
}

/**
 * The name and symbol a Metaplex metadata account holds: key, update authority and mint, then
 * the name, symbol and URI as length-prefixed text padded with zero bytes. Null when the
 * account is missing or holds something else.
 */
export function parseMetadata(value: unknown, mint: string): TokenNames | null {
  const account = value as { owner?: unknown; data?: unknown } | null;
  if (!account || account.owner !== METADATA_PROGRAM || !Array.isArray(account.data)) return null;
  const [encoded, encoding] = account.data as unknown[];
  if (encoding !== 'base64' || typeof encoded !== 'string') return null;
  const data = Buffer.from(encoded, 'base64');
  // Key 4 is a token's metadata (MetadataV1).
  if (data.length < 65 || data[0] !== 4 || base58Text(data.subarray(33, 65)) !== mint) return null;
  const name = borshString(data, 65);
  const symbol = name && borshString(data, name.next);
  if (!name || !symbol) return null;
  return { name: name.text, symbol: symbol.text };
}

/** What a mint account says as the RPC parses it: its decimals, and a Token-2022 mint's own
 * name and symbol. */
export function parseMint(value: unknown): { decimals: number | null; names: TokenNames | null } {
  const account = value as { data?: { parsed?: { type?: unknown; info?: unknown } } } | null;
  const parsed = account?.data?.parsed;
  if (parsed?.type !== 'mint' || !parsed.info || typeof parsed.info !== 'object')
    return { decimals: null, names: null };
  const info = parsed.info as { decimals?: unknown; extensions?: unknown };
  const decimals =
    Number.isSafeInteger(info.decimals) && (info.decimals as number) >= 0
      ? (info.decimals as number)
      : null;
  const extensions = Array.isArray(info.extensions) ? info.extensions : [];
  const found = extensions.find(
    (item) => (item as { extension?: unknown })?.extension === 'tokenMetadata',
  ) as { state?: { name?: unknown; symbol?: unknown } } | undefined;
  const names = found?.state
    ? {
        name: typeof found.state.name === 'string' ? found.state.name : null,
        symbol: typeof found.state.symbol === 'string' ? found.state.symbol : null,
      }
    : null;
  return { decimals, names };
}
