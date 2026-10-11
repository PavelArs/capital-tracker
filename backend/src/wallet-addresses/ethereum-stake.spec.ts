import {
  balanceOfUnderlyingCall,
  etherStakeMoves,
  etherTransactions,
  readSymbol,
  readUint,
  STAKE_SELECTOR,
  stakeTarget,
  symbolCall,
} from './ethereum-stake';
import type { InternalTransfer, NormalTransaction } from './etherscan-client';

// Synthetic addresses, hashes and amounts only (track-ethereum-stake).
const owned = `0x${'a1'.repeat(20)}`;
const other = `0x${'b2'.repeat(20)}`;
const pool = `0x${'c3'.repeat(20)}`;
const queue = `0x${'d4'.repeat(20)}`;
const hash = (digit: string) => `0x${digit.repeat(64)}`;
const ether = (value: string) => BigInt(value) * 10n ** 18n;
const at = 1_720_000_000;

const tx = (overrides: Partial<NormalTransaction>, input = STAKE_SELECTOR): NormalTransaction => ({
  hash: hash('1'),
  blockNumber: 20_000_001,
  timeStamp: at,
  blockHash: hash('b'),
  from: owned,
  to: pool,
  value: ether('2'),
  fee: 10n ** 15n,
  failed: false,
  raw: { input },
  ...overrides,
});
const inner = (overrides: Partial<InternalTransfer>): InternalTransfer => ({
  hash: hash('2'),
  blockNumber: 20_000_002,
  timeStamp: at + 12,
  from: queue,
  to: owned,
  value: ether('1'),
  failed: false,
  raw: { synthetic: true },
  ...overrides,
});
const word = (value: bigint) => `0x${value.toString(16).padStart(64, '0')}`;
const text = (value: string) =>
  `0x${word(32n).slice(2)}${word(BigInt(value.length)).slice(2)}${Buffer.from(value)
    .toString('hex')
    .padEnd(64, '0')}`;

describe('ETH-STAKE-FIND: deposits into a pool', () => {
  it('reads a stake() call with ether as a deposit into the contract it called', () => {
    expect(stakeTarget(owned, tx({}))).toBe(pool);
    expect(stakeTarget(owned, tx({}, '0x3A4B66F1'))).toBe(pool);
  });

  it.each([
    ['another call', tx({}, '0xa9059cbb')],
    ['a plain payment', tx({}, '0x')],
    ['no ether', tx({ value: 0n })],
    ['a reverted call', tx({ failed: true })],
    ['a call someone else sent', tx({ from: other })],
    ['a contract creation', tx({ to: '' })],
  ])('ignores %s', (_case, item) => {
    expect(stakeTarget(owned, item)).toBeNull();
  });

  it('builds the calls a pool answers', () => {
    expect(balanceOfUnderlyingCall(owned)).toBe(`0x3af9e669${'0'.repeat(24)}${'a1'.repeat(20)}`);
    expect(symbolCall()).toBe('0x95d89b41');
  });

  it('reads one word, else nothing', () => {
    expect(readUint(word(ether('3')))).toBe(ether('3'));
    expect(readUint(null)).toBeNull();
    expect(readUint('0x')).toBeNull();
    expect(readUint(`${word(1n)}00`)).toBeNull();
  });

  it('reads a plain ticker from a string or bytes32 answer', () => {
    expect(readSymbol(text('ocsETH'))).toBe('ocsETH');
    expect(readSymbol(`0x${Buffer.from('osETH').toString('hex').padEnd(64, '0')}`)).toBe('osETH');
    expect(readSymbol(text('<b>'))).toBeNull();
    expect(readSymbol(text('A'.repeat(17)))).toBeNull();
    expect(readSymbol('0x')).toBeNull();
    expect(readSymbol(null)).toBeNull();
  });
});

describe('ETH-STAKE-MOVE: ether into and out of a known pool', () => {
  it('keeps only the transactions the address sent, each with its internal transfers', () => {
    const sent = etherTransactions(
      owned,
      [tx({}), tx({ hash: hash('2'), from: other, to: owned })],
      [inner({ hash: hash('1') }), inner({ hash: hash('3') })],
    );
    expect(sent).toEqual([{ tx: tx({}), inner: [inner({ hash: hash('1') })] }]);
  });

  it('moves a deposit in and a claimed exit back out, oldest first', () => {
    const claim = tx({
      hash: hash('2'),
      blockNumber: 20_000_002,
      timeStamp: at + 12,
      value: 0n,
    });
    const moves = etherStakeMoves(
      owned,
      [
        { tx: claim, inner: [inner({}), inner({ value: ether('1') / 2n, failed: true })] },
        { tx: tx({}), inner: [] },
      ],
      new Set([pool]),
    );
    expect(moves).toEqual([
      {
        txid: '1'.repeat(64),
        contract: pool,
        blockHeight: 20_000_001,
        blockTime: new Date(at * 1000).toISOString(),
        units: ether('2'),
      },
      {
        txid: '2'.repeat(64),
        contract: pool,
        blockHeight: 20_000_002,
        blockTime: new Date((at + 12) * 1000).toISOString(),
        units: -ether('1'),
      },
    ]);
  });

  it('moves nothing for a contract that is no pool, a reverted call or a call without ether', () => {
    expect(etherStakeMoves(owned, [{ tx: tx({}), inner: [] }], new Set([other]))).toEqual([]);
    expect(
      etherStakeMoves(owned, [{ tx: tx({ failed: true }), inner: [] }], new Set([pool])),
    ).toEqual([]);
    expect(
      etherStakeMoves(owned, [{ tx: tx({ value: 0n }, '0x721c6513'), inner: [] }], new Set([pool])),
    ).toEqual([]);
  });
});
