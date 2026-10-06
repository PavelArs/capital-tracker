import { createHash } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';

function bad(): never {
  throw new BadRequestException('Invalid Ethereum address');
}

// EIP-55: a mixed-case address carries a checksum in the case of its letters.
function hasValidChecksum(hex: string): boolean {
  const hash = createHash('keccak-256').update(hex.toLowerCase()).digest('hex');
  return [...hex].every((character, index) => {
    if (!/[a-f]/i.test(character)) return true;
    const upper = Number.parseInt(hash[index], 16) >= 8;
    return character === (upper ? character.toUpperCase() : character.toLowerCase());
  });
}

/**
 * WAL-INVALID: a 0x-prefixed 20-byte account address. All lower or all upper case carries no
 * checksum; mixed case must match EIP-55. The stored form is lower case.
 */
export function normalizeEthereumAddress(value: unknown): string {
  if (typeof value !== 'string' || !/^0[xX][0-9a-fA-F]{40}$/.test(value)) return bad();
  const hex = value.slice(2);
  const mixed = hex !== hex.toLowerCase() && hex !== hex.toUpperCase();
  if (mixed && !hasValidChecksum(hex)) return bad();
  return `0x${hex.toLowerCase()}`;
}
