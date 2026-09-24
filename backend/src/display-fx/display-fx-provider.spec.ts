import { isPublicDestination } from './display-fx-provider';

describe('DFX provider direct destination boundary', () => {
  it.each([
    '127.0.0.1',
    '0.0.0.0',
    '10.1.2.3',
    '172.16.0.1',
    '192.168.1.1',
    '169.254.169.254',
    '100.100.100.200',
    '224.0.0.1',
    '192.0.2.1',
    '255.255.255.255',
    '::1',
    '::',
    'fe80::1',
    'fc00::1',
    '::ffff:127.0.0.1',
    '::ffff:169.254.169.254',
    '2001:db8::1',
    'not-an-address',
  ])('rejects non-public resolved target %s', (address) => {
    expect(isPublicDestination(address)).toBe(false);
  });

  it.each(['1.1.1.1', '8.8.8.8', '2606:4700:4700::1111', '::ffff:8.8.8.8'])(
    'accepts routable resolved target %s while TLS still uses the fixed host',
    (address) => {
      expect(isPublicDestination(address)).toBe(true);
    },
  );
});
