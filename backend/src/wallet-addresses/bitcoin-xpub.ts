import { createHash, createHmac } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import { BASE58, BECH32, polymod, sha256 } from './bitcoin-address';

// M21: a Bitcoin account tracked through its extended public key (BIP-32), the way Trezor
// Suite and other HD wallets show it. Only public derivation exists here: the key derives the
// account's receiving (chain 0) and change (chain 1) addresses and can never spend.

export type KeyPrefix = 'xpub' | 'ypub' | 'zpub';
/** The address type the key's prefix stands for (SLIP-132): BIP-44, BIP-49 and BIP-84. */
export type AddressScript = 'legacy' | 'nested-segwit' | 'native-segwit';

const VERSIONS: Record<KeyPrefix, { version: number; script: AddressScript }> = {
  xpub: { version: 0x0488b21e, script: 'legacy' },
  ypub: { version: 0x049d7cb2, script: 'nested-segwit' },
  zpub: { version: 0x04b24746, script: 'native-segwit' },
};

/** 78 bytes and a 4-byte checksum in base58: 111 or 112 characters. */
export const EXTENDED_KEY_PATTERN = /^[xyz]pub[1-9A-HJ-NP-Za-km-z]{107,108}$/;

export interface ChildKey {
  /** The compressed public key, 33 bytes. */
  publicKey: Buffer;
  chainCode: Buffer;
}

export interface ExtendedKey extends ChildKey {
  prefix: KeyPrefix;
  script: AddressScript;
  /** The key as it was pasted, decoded: version, depth, parent, index, chain code, key. */
  serialized: Buffer;
}

function bad(): never {
  throw new BadRequestException('Invalid Bitcoin account key');
}

// secp256k1, for public derivation only: no secret ever passes through this arithmetic.
const P = 2n ** 256n - 2n ** 32n - 977n;
const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
type Point = { x: bigint; y: bigint } | null;
const G: Point = {
  x: 0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798n,
  y: 0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8n,
};

const mod = (value: bigint) => ((value % P) + P) % P;

function inverse(value: bigint): bigint {
  let [low, high] = [mod(value), P];
  let [lowFactor, highFactor] = [1n, 0n];
  while (low > 1n) {
    const ratio = high / low;
    [low, high] = [high - ratio * low, low];
    [lowFactor, highFactor] = [highFactor - ratio * lowFactor, lowFactor];
  }
  return mod(lowFactor);
}

function power(base: bigint, exponent: bigint): bigint {
  let result = 1n;
  let square = mod(base);
  for (let rest = exponent; rest > 0n; rest >>= 1n) {
    if (rest & 1n) result = mod(result * square);
    square = mod(square * square);
  }
  return result;
}

function double(point: Point): Point {
  if (!point || point.y === 0n) return null;
  const slope = mod(3n * point.x * point.x * inverse(2n * point.y));
  const x = mod(slope * slope - 2n * point.x);
  return { x, y: mod(slope * (point.x - x) - point.y) };
}

function add(left: Point, right: Point): Point {
  if (!left) return right;
  if (!right) return left;
  if (left.x === right.x) return left.y === right.y ? double(left) : null;
  const slope = mod((right.y - left.y) * inverse(right.x - left.x));
  const x = mod(slope * slope - left.x - right.x);
  return { x, y: mod(slope * (left.x - x) - left.y) };
}

function multiply(scalar: bigint, point: Point): Point {
  let result: Point = null;
  let addend = point;
  for (let rest = scalar; rest > 0n; rest >>= 1n) {
    if (rest & 1n) result = add(result, addend);
    addend = double(addend);
  }
  return result;
}

const toBigInt = (bytes: Buffer) => BigInt(`0x${bytes.toString('hex') || '0'}`);
const toBytes = (value: bigint) => Buffer.from(value.toString(16).padStart(64, '0'), 'hex');

/** A compressed key's point; null when it is not one on the curve. */
function decompress(key: Buffer): Point {
  if (key.length !== 33 || (key[0] !== 0x02 && key[0] !== 0x03)) return null;
  const x = toBigInt(key.subarray(1));
  if (x >= P) return null;
  const square = mod(x * x * x + 7n);
  const root = power(square, (P + 1n) / 4n);
  if (mod(root * root) !== square) return null;
  const y = (root & 1n) === BigInt(key[0] & 1) ? root : P - root;
  return { x, y };
}

function compress(point: { x: bigint; y: bigint }): Buffer {
  return Buffer.concat([Buffer.from([point.y & 1n ? 0x03 : 0x02]), toBytes(point.x)]);
}

const hash160 = (data: Buffer) =>
  createHash('ripemd160').update(sha256(data)).digest() as Buffer<ArrayBuffer>;

function base58Encode(bytes: Buffer): string {
  let number = toBigInt(bytes);
  let text = '';
  while (number > 0n) {
    text = BASE58[Number(number % 58n)] + text;
    number /= 58n;
  }
  const zeros = bytes.length - bytes.toString('hex').replace(/^(00)+/, '').length / 2;
  return '1'.repeat(zeros) + text;
}

function base58Decode(text: string): Buffer {
  let number = 0n;
  for (const character of text) number = number * 58n + BigInt(BASE58.indexOf(character));
  const zeros = text.length - text.replace(/^1+/, '').length;
  const hex = number === 0n ? '' : number.toString(16);
  return Buffer.concat([
    Buffer.alloc(zeros),
    Buffer.from(hex.padStart(hex.length + (hex.length % 2), '0'), 'hex'),
  ]);
}

const checksum = (payload: Buffer) => sha256(sha256(payload)).subarray(0, 4);
const base58Check = (payload: Buffer) => base58Encode(Buffer.concat([payload, checksum(payload)]));

/** Base58check text of 78 serialized key bytes. */
export function encodeExtendedKey(serialized: Buffer): string {
  return base58Check(serialized);
}

// BIP-173 bech32 for a version 0 witness program on mainnet ("bc").
function segwitAddress(program: Buffer): string {
  const words = [0];
  let accumulator = 0;
  let bits = 0;
  for (const byte of program) {
    accumulator = (accumulator << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      words.push((accumulator >>> bits) & 31);
    }
  }
  if (bits > 0) words.push((accumulator << (5 - bits)) & 31);
  const value = polymod([3, 3, 0, 2, 3, ...words, 0, 0, 0, 0, 0, 0]) ^ 1;
  const check = Array.from({ length: 6 }, (_item, index) => (value >>> (5 * (5 - index))) & 31);
  return `bc1${[...words, ...check].map((word) => BECH32[word]).join('')}`;
}

export function isExtendedKey(value: unknown): value is string {
  return typeof value === 'string' && EXTENDED_KEY_PATTERN.test(value);
}

/** XPUB-KEY: a mainnet account public key with a valid checksum and a point on the curve. */
export function parseExtendedKey(text: unknown): ExtendedKey {
  if (!isExtendedKey(text)) return bad();
  const bytes = base58Decode(text);
  if (bytes.length !== 82) return bad();
  const serialized = bytes.subarray(0, 78);
  if (!checksum(serialized).equals(bytes.subarray(78))) return bad();
  const prefix = text.slice(0, 4) as KeyPrefix;
  const { version, script } = VERSIONS[prefix];
  if (serialized.readUInt32BE(0) !== version) return bad();
  const publicKey = serialized.subarray(45, 78);
  if (!decompress(publicKey)) return bad();
  return {
    prefix,
    script,
    serialized: Buffer.from(serialized),
    chainCode: Buffer.from(serialized.subarray(13, 45)),
    publicKey: Buffer.from(publicKey),
  };
}

/** The stored form of an account key: exactly as the wallet shows it, once verified. */
export function normalizeExtendedKey(value: unknown): string {
  parseExtendedKey(value);
  return value as string;
}

/** XPUB-DERIVE: BIP-32 CKDpub, the non-hardened child of a public key. */
export function deriveChildKey(parent: ChildKey, index: number): ChildKey {
  if (!Number.isInteger(index) || index < 0 || index >= 0x80000000) {
    throw new Error('Only non-hardened children derive from a public key');
  }
  const data = Buffer.alloc(37);
  parent.publicKey.copy(data);
  data.writeUInt32BE(index, 33);
  const digest = createHmac('sha512', parent.chainCode).update(data).digest();
  const tweak = toBigInt(digest.subarray(0, 32));
  const child = tweak < N ? add(multiply(tweak, G), decompress(parent.publicKey)) : null;
  // BIP-32: such an index is skipped; the odds are below 1 in 2^127.
  if (!child) throw new Error('Unusable child index');
  return { publicKey: compress(child), chainCode: Buffer.from(digest.subarray(32)) };
}

/** XPUB-ADDRESS: an account's addresses, receiving (chain 0) and change (chain 1). */
export class AccountKey {
  readonly key: ExtendedKey;
  private readonly chains = new Map<number, ChildKey>();

  constructor(text: string) {
    this.key = parseExtendedKey(text);
  }

  address(chain: 0 | 1, index: number): string {
    let parent = this.chains.get(chain);
    if (!parent) {
      parent = deriveChildKey(this.key, chain);
      this.chains.set(chain, parent);
    }
    const hash = hash160(deriveChildKey(parent, index).publicKey);
    switch (this.key.script) {
      case 'legacy':
        return base58Check(Buffer.concat([Buffer.from([0x00]), hash]));
      case 'nested-segwit':
        // P2SH wrapping the P2WPKH program 0x0014 <hash>.
        return base58Check(
          Buffer.concat([
            Buffer.from([0x05]),
            hash160(Buffer.concat([Buffer.from([0x00, 0x14]), hash])),
          ]),
        );
      case 'native-segwit':
        return segwitAddress(hash);
    }
  }
}
