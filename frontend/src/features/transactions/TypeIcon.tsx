import type { Operation } from '@api/operations.api';
import type { ReactNode } from 'react';

// Stroke icons of the accepted prototype's transaction types (cart for a buy, arrows for
// an unclassified incoming or outgoing transaction).
const paths = {
  buy: (
    <>
      <circle cx="9" cy="20" r="1.3" />
      <circle cx="18" cy="20" r="1.3" />
      <path d="M2 3h3l2.7 12.4a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.6L21 7H6" />
    </>
  ),
  sell: (
    <>
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <circle cx="12" cy="12" r="2.5" />
      <path d="M6 12h.01M18 12h.01" />
    </>
  ),
  move: <path d="m16 3 4 4-4 4M20 7H8M8 21l-4-4 4-4M4 17h12" />,
  in: <path d="M17 7 7 17M17 17H7V7" />,
  out: <path d="M7 7h10v10M7 17 17 7" />,
  reward: <path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z" />,
  airdrop: <path d="M12 3v14M5 12l7 7 7-7M5 21h14" />,
  opening: <path d="M12 5v14M5 12h14" />,
  check: <path d="M20 6 9 17l-5-5" />,
  chain: (
    <>
      <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" />
      <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />
    </>
  ),
} satisfies Record<string, ReactNode>;

type Glyph = keyof typeof paths;

function glyph(operation: Operation): Glyph {
  switch (operation.type) {
    case 'buy':
    case 'sell':
      return operation.type;
    case 'transfer':
    case 'swap':
      return 'move';
    case 'reward':
    case 'staking-reward':
      return 'reward';
    case 'airdrop':
      return 'airdrop';
    case 'opening-balance':
      return 'opening';
    case 'deposit':
      return 'in';
    case 'withdrawal':
      return 'out';
    default:
      return operation.direction === 'internal' ? 'move' : operation.direction;
  }
}

export function Glyph({ name }: { name: Glyph }) {
  return (
    <svg className="transactions-glyph" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {paths[name]}
    </svg>
  );
}

/** The square type mark in front of each row's type. */
export default function TypeIcon({ operation }: { operation: Operation }) {
  return (
    <span className="transactions-type-icon">
      <Glyph name={glyph(operation)} />
    </span>
  );
}
