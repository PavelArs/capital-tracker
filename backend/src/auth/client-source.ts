import { isIP } from 'node:net';
import { BadRequestException, ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import * as ipaddr from 'ipaddr.js';

export const AUTH_CLIENT_SOURCE = 'auth-client-source';
export const AuthClientSource = () => SetMetadata(AUTH_CLIENT_SOURCE, true);

export function canonicalIp(value: unknown): string {
  if (typeof value !== 'string' || value.length > 45 || value.includes('%') || !isIP(value)) {
    throw new BadRequestException('Invalid client address');
  }
  const address = ipaddr.parse(value);
  if (address.kind() === 'ipv6' && (address as ipaddr.IPv6).isIPv4MappedAddress()) {
    return (address as ipaddr.IPv6).toIPv4Address().toString();
  }
  return address.toString();
}

export function parseTrustedProxyIps(value: unknown): ReadonlySet<string> {
  try {
    if (typeof value !== 'string') throw new Error();
    const entries: unknown = JSON.parse(value);
    if (!Array.isArray(entries) || entries.length > 8) throw new Error();
    const peers = new Set(entries.map(canonicalIp));
    if (peers.size !== entries.length) throw new Error();
    return peers;
  } catch {
    throw new Error('Invalid TRUSTED_PROXY_IPS configuration');
  }
}

export function rateSubject(value: string): string {
  const canonical = canonicalIp(value);
  const address = ipaddr.parse(canonical);
  if (address.kind() === 'ipv4') return `v4:${canonical}/32`;
  const bytes = address.toByteArray();
  bytes.fill(0, 8);
  return `v6:${ipaddr.fromByteArray(bytes).toString()}/64`;
}

interface SourceRequest {
  socket: { remoteAddress?: string };
  headers: Record<string, unknown>;
  rawHeaders: string[];
  ip?: string;
}
interface ClientSource {
  readonly peer: string;
  readonly client: string;
  readonly subject: string;
}

@Injectable()
export class AuthClientSourceService {
  private readonly peers: ReadonlySet<string>;
  private readonly cache = new WeakMap<object, Readonly<ClientSource>>();

  constructor(
    config: ConfigService,
    private readonly reflector: Reflector,
  ) {
    this.peers = parseTrustedProxyIps(config.get('TRUSTED_PROXY_IPS'));
  }

  resolve(request: SourceRequest): Readonly<ClientSource> {
    const cached = this.cache.get(request);
    if (cached) return cached;
    const peer = canonicalIp(request.socket?.remoteAddress);
    let client = peer;
    if (this.peers.has(peer)) {
      const raw = request.rawHeaders;
      if (!Array.isArray(raw) || raw.length % 2 !== 0) {
        throw new BadRequestException('Invalid client address');
      }
      const forwarded: string[] = [];
      for (let index = 0; index < raw.length; index += 2) {
        if (typeof raw[index] !== 'string') throw new BadRequestException('Invalid client address');
        if (raw[index].toLowerCase() === 'x-forwarded-for') forwarded.push(raw[index + 1]);
      }
      if (
        forwarded.length !== 1 ||
        typeof request.headers['x-forwarded-for'] !== 'string' ||
        forwarded[0] !== request.headers['x-forwarded-for']
      ) {
        throw new BadRequestException('Invalid client address');
      }
      client = canonicalIp(forwarded[0]);
    }
    const source = Object.freeze({ peer, client, subject: rateSubject(client) });
    this.cache.set(request, source);
    return source;
  }

  private marked(context: ExecutionContext): boolean {
    return this.reflector.get<boolean>(AUTH_CLIENT_SOURCE, context.getHandler()) === true;
  }

  validate(context: ExecutionContext): void {
    if (!this.marked(context)) return;
    context.switchToHttp().getResponse().setHeader('Cache-Control', 'no-store');
    this.resolve(context.switchToHttp().getRequest<SourceRequest>());
  }

  async tracker(
    request: SourceRequest & { authSession?: { hash: string } },
    context: ExecutionContext,
  ): Promise<string> {
    if (!this.marked(context)) {
      // Behind the edge every client shares one peer address; count each session apart.
      const session = request.authSession?.hash;
      return session ? `session:${session}` : (request.ip as string);
    }
    this.validate(context);
    // Throttler's unchanged generateKey hashes this bounded subject with handler/name.
    return this.resolve(request).subject;
  }
}
