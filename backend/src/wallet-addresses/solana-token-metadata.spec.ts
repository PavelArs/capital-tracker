import { base58Bytes } from './solana-address';
import {
  base58Text,
  isOnCurve,
  METADATA_PROGRAM,
  metadataAddress,
  parseMetadata,
  parseMint,
} from './solana-token-metadata';

// Public mints and their metadata accounts as @solana/web3.js 1.98.0 derives them
// (PublicKey.findProgramAddressSync); bumps 255, 250 and 254 exercise the curve check.
const derived = [
  ['EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', '5x38Kp4hvdomTCnCrAny4UtMUt5rQBdB6px2K1Ui45Wq'],
  ['Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', '8c3zk1t1qt3RU43ckuvPkCS7HLbjJqq3J3Me8ov4aHrp'],
  ['DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', 'FDZZbyY9XGpL3CNKUZxLk3wFTTQYL3TkDiDzqxrizcPN'],
  ['So11111111111111111111111111111111111111112', '6dM4TqWyWJsbx7obrdLcviBkTafD5E8av61zfU6jq57X'],
  ['7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU', '34rrn4k94sP69H2cC7CNDK4J34vX4j17EYDpTvSGUmF2'],
];
// sha256("x0".."x7") and whether each is a curve point, as PublicKey.isOnCurve says.
const points: [string, boolean][] = [
  ['b70a14ee1e15d7aa94bd810ec06f4cb77a346e8f33aef6bfeae3d7c4442d7a93', true],
  ['ec31682fde561917952ff78a7a8adeffd0febc372dd26871916c46c630381b45', true],
  ['844ecc08164e2eab27634a9adee1afa6599e589570e719784e080ce747fc0e45', true],
  ['844b69c4d54cc264bc2dadb6bb70f53bc123beafc0f58d81ed8cd4a07c24a5a7', true],
  ['7985b0c8b858e77f57c6d403b315ade04d2485d6ec2d09694256eadd20db6f27', false],
  ['29f2394eb92d0ded9247b8d7188ebddae3e13c71ebcf939302619b29604486b0', false],
  ['0520220e0f12bb847b57ad4bb3dfe908368a1057a7028b92186e73769fe3cc62', true],
  ['8cf3ebbdacddfddd6f13673f945f523cc9813df2fcdf2a420a230d283bdf4a7a', true],
];

const text = (value: string) => {
  const bytes = Buffer.from(value, 'utf8');
  const length = Buffer.alloc(4);
  length.writeUInt32LE(bytes.length + 2);
  return Buffer.concat([length, bytes, Buffer.alloc(2)]);
};
function metadata(mint: string, name: string, symbol: string, key = 4) {
  const data = Buffer.concat([
    Buffer.of(key),
    Buffer.alloc(32, 9),
    base58Bytes(mint) as Buffer,
    text(name),
    text(symbol),
    text('https://example.invalid/token.json'),
  ]);
  return { owner: METADATA_PROGRAM, data: [data.toString('base64'), 'base64'] };
}

describe('TOKEN-ANY: an SPL token’s name from the chain', () => {
  it('writes base58 as Solana does', () => {
    for (const [mint] of derived) expect(base58Text(base58Bytes(mint) as Buffer)).toBe(mint);
    expect(base58Text(Buffer.alloc(32))).toBe('1'.repeat(32));
  });

  it('decides curve points as Solana does', () => {
    for (const [hex, onCurve] of points) expect(isOnCurve(Buffer.from(hex, 'hex'))).toBe(onCurve);
  });

  it('finds the Metaplex metadata account of a mint', () => {
    for (const [mint, account] of derived) expect(metadataAddress(mint)).toBe(account);
  });

  it('reads the name and symbol of a metadata account, and nothing from anything else', () => {
    const [mint] = derived[2];
    expect(parseMetadata(metadata(mint, 'Synthetic Bonk', 'SBONK'), mint)).toEqual({
      name: 'Synthetic Bonk',
      symbol: 'SBONK',
    });
    expect(parseMetadata(metadata(mint, 'x', 'y'), derived[0][0])).toBeNull();
    expect(parseMetadata(metadata(mint, 'x', 'y', 5), mint)).toBeNull();
    expect(parseMetadata({ ...metadata(mint, 'x', 'y'), owner: 'other' }, mint)).toBeNull();
    expect(parseMetadata(null, mint)).toBeNull();
  });

  it('reads a mint’s decimals and a Token-2022 mint’s own name', () => {
    const mint = (info: Record<string, unknown>) => ({ data: { parsed: { type: 'mint', info } } });
    expect(parseMint(mint({ decimals: 9 }))).toEqual({ decimals: 9, names: null });
    expect(
      parseMint(
        mint({
          decimals: 6,
          extensions: [
            { extension: 'mintCloseAuthority', state: {} },
            { extension: 'tokenMetadata', state: { name: 'Synthetic Dollar', symbol: 'SUSD' } },
          ],
        }),
      ),
    ).toEqual({ decimals: 6, names: { name: 'Synthetic Dollar', symbol: 'SUSD' } });
    expect(parseMint(null)).toEqual({ decimals: null, names: null });
    expect(parseMint({ data: ['', 'base64'] })).toEqual({ decimals: null, names: null });
  });
});
