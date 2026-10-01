import { lookup } from 'node:dns';
import { Agent } from 'node:https';
import { ConfigService } from '@nestjs/config';
import axios, { type AxiosRequestConfig } from 'axios';
import { DisplayFxProvider, isPublicDestination } from './display-fx-provider';

jest.mock('node:dns', () => ({
  ...jest.requireActual('node:dns'),
  lookup: jest.fn(),
}));
jest.mock('axios', () => ({
  __esModule: true,
  default: { get: jest.fn() },
}));

const httpGet = axios.get as jest.Mock;
const dnsLookup = lookup as unknown as jest.Mock;

async function requestOptions(config: Record<string, string>): Promise<AxiosRequestConfig> {
  httpGet.mockResolvedValue({ status: 500, headers: {}, data: '' });
  await expect(new DisplayFxProvider(new ConfigService(config)).fetch()).rejects.toThrow(
    'Daily display source unavailable',
  );
  expect(httpGet).toHaveBeenCalledTimes(1);
  expect(httpGet.mock.calls[0][0]).toBe('https://open.er-api.com/v6/latest/USD');
  return httpGet.mock.calls[0][1] as AxiosRequestConfig;
}

describe('DFX provider direct destination boundary', () => {
  beforeEach(() => jest.clearAllMocks());

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

  it('uses a connection-time HTTPS lookup and refuses mixed public/private DNS answers', async () => {
    const options = await requestOptions({ DISPLAY_FX_TRUST_PROXY: 'false' });
    expect(options.proxy).toBe(false);
    expect(options.httpsAgent).toBeInstanceOf(Agent);
    expect(options.maxRedirects).toBe(0);
    const resolver = (options.httpsAgent as Agent).options.lookup;
    expect(resolver).toEqual(expect.any(Function));
    dnsLookup.mockImplementation((_host, _options, callback) =>
      callback(null, [
        { address: '1.1.1.1', family: 4 },
        { address: '127.0.0.1', family: 4 },
      ]),
    );
    await new Promise<void>((resolve, reject) => {
      resolver?.('open.er-api.com', { all: false }, (error) => {
        try {
          expect(error).toBeInstanceOf(Error);
          expect(error?.message).toBe('FX destination refused');
          resolve();
        } catch (assertion) {
          reject(assertion);
        }
      });
    });
    expect(dnsLookup).toHaveBeenCalledWith(
      'open.er-api.com',
      expect.objectContaining({ all: true }),
      expect.any(Function),
    );
  });

  it('delegates DNS to the explicitly trusted proxy without passing the direct agent', async () => {
    const options = await requestOptions({
      DISPLAY_FX_TRUST_PROXY: 'true',
      HTTPS_PROXY: 'http://egress.example:8080',
    });
    expect(options.proxy).toEqual({ protocol: 'http', host: 'egress.example', port: 8080 });
    expect(options.httpsAgent).toBeUndefined();
    expect(dnsLookup).not.toHaveBeenCalled();
  });
});
