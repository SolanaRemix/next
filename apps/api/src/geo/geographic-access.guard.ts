import { ForbiddenException, Injectable, SetMetadata } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import ipaddr from 'ipaddr.js';

const SKIP_GEOGRAPHIC_ACCESS_KEY = 'skipGeographicAccess';
export const SkipGeographicAccess = (): MethodDecorator & ClassDecorator =>
  SetMetadata(SKIP_GEOGRAPHIC_ACCESS_KEY, true);

interface GeoRequest {
  socket: { remoteAddress?: string };
  headers: Record<string, string | string[] | undefined>;
}

@Injectable()
export class GeographicAccessGuard implements CanActivate {
  private readonly blockedCountries: ReadonlySet<string>;
  private readonly trustedProxyCidrs: readonly ReturnType<typeof ipaddr.parseCIDR>[];

  constructor(config: ConfigService, private readonly reflector: Reflector) {
    this.blockedCountries = new Set(
      (config.get<string>('GEO_BLOCKED_COUNTRIES') ?? '')
        .split(',')
        .map((country) => country.trim().toUpperCase())
        .filter(Boolean),
    );
    const cidrs = (config.get<string>('GEO_TRUSTED_PROXY_CIDRS') ?? '')
      .split(',')
      .map((cidr) => cidr.trim())
      .filter(Boolean);
    this.trustedProxyCidrs = cidrs.map((cidr) => ipaddr.parseCIDR(cidr));
  }

  canActivate(context: ExecutionContext): boolean {
    if (this.reflector.getAllAndOverride<boolean>(SKIP_GEOGRAPHIC_ACCESS_KEY, [
      context.getHandler(),
      context.getClass(),
    ])) return true;
    if (this.blockedCountries.size === 0) return true;

    const request = context.switchToHttp().getRequest<GeoRequest>();
    const remoteAddress = request.socket.remoteAddress;
    if (!remoteAddress || !this.isTrustedProxy(remoteAddress)) {
      throw new ForbiddenException('Geographic policy requires a trusted edge proxy.');
    }

    const rawCountry = request.headers['cf-ipcountry'];
    const country = typeof rawCountry === 'string' ? rawCountry.trim().toUpperCase() : '';
    if (!/^[A-Z]{2}$/.test(country) || country === 'XX' || country === 'T1') {
      throw new ForbiddenException('Client country could not be verified by the trusted edge.');
    }
    if (this.blockedCountries.has(country)) {
      throw new ForbiddenException('This service is unavailable in your region.');
    }
    return true;
  }

  private isTrustedProxy(remoteAddress: string): boolean {
    let address: ipaddr.IPv4 | ipaddr.IPv6;
    try {
      address = ipaddr.process(remoteAddress);
    } catch {
      return false;
    }
    return this.trustedProxyCidrs.some(([network, prefix]) =>
      address.kind() === network.kind() && address.match(network, prefix));
  }
}
