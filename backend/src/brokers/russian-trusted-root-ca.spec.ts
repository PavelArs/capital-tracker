import { X509Certificate } from 'node:crypto';
import { RUSSIAN_TRUSTED_ROOT_CA_SHA256, russianTrustedRootCa } from './russian-trusted-root-ca';

describe('BROKER-CONNECT: the root added for T-Bank', () => {
  const certificate = new X509Certificate(russianTrustedRootCa);

  it('is the Russian Trusted Root CA with its published fingerprint', () => {
    expect(certificate.fingerprint256).toBe(RUSSIAN_TRUSTED_ROOT_CA_SHA256);
    expect(certificate.subject).toContain('CN=Russian Trusted Root CA');
  });

  it('is a self-signed CA, not a certificate for one site', () => {
    expect(certificate.ca).toBe(true);
    expect(certificate.issuer).toBe(certificate.subject);
    expect(certificate.verify(certificate.publicKey)).toBe(true);
  });
});
