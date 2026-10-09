import { describe, expect, it } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { GeographicAccessGuard } from './geographic-access.guard.js';

function createGuard(blockedCountries = 'US', trustedCidrs = '192.0.2.0/24') {
  return new GeographicAccessGuard({
    get: (key: string) => ({
      GEO_BLOCKED_COUNTRIES: blockedCountries,
      GEO_TRUSTED_PROXY_CIDRS: trustedCidrs,
    })[key],
  } as never);
}

function context(remoteAddress: string, country?: string) {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        socket: { remoteAddress },
        headers: { 'cf-ipcountry': country },
      }),
    }),
  } as never;
}

describe('GeographicAccessGuard', () => {
  it('blocks a configured country reported by a trusted proxy', () => {
    expect(() => createGuard().canActivate(context('192.0.2.25', 'us')))
      .toThrow(ForbiddenException);
  });

  it('ignores forged country headers from untrusted peers', () => {
    expect(() => createGuard().canActivate(context('203.0.113.25', 'US')))
      .toThrow(/trusted edge proxy/i);
  });

  it('fails closed when trusted proxy country data is missing or unknown', () => {
    expect(() => createGuard().canActivate(context('192.0.2.25')))
      .toThrow(/could not be verified/i);
    expect(() => createGuard().canActivate(context('192.0.2.25', 'XX')))
      .toThrow(/could not be verified/i);
  });

  it('allows countries not configured as restricted', () => {
    expect(createGuard('US, GB').canActivate(context('192.0.2.25', 'CA'))).toBe(true);
  });

  it('leaves geographic enforcement disabled when no country policy is configured', () => {
    expect(createGuard('', '').canActivate(context('203.0.113.10'))).toBe(true);
  });
});
