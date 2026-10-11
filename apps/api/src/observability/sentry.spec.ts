import { describe, expect, it } from 'vitest';
import type { ErrorEvent } from '@sentry/nestjs';
import { sanitizeSentryEvent } from './sentry.js';

describe('sanitizeSentryEvent', () => {
  it('keeps only a validated request ID and safe error type while stripping sensitive event data', () => {
    const requestId = '1f3c9a12-8d44-4b8a-a12b-6d5e4f3a2b1c';
    const event: ErrorEvent = {
      type: undefined,
      event_id: 'abc123',
      message: '******',
      request: {
        url: 'https://api.example.com/api/private?token=secret',
        method: 'POST',
        query_string: 'token=secret',
        headers: {
          Authorization: '******',
          Cookie: 'session=secret',
          'X-Request-Id': requestId,
        },
        cookies: { session: 'secret' },
        data: { password: 'secret' },
      },
      user: { id: 'private-user' },
      breadcrumbs: [{ message: 'private breadcrumb', data: { token: 'secret' } }],
      contexts: { trace: { trace_id: 'private-trace', span_id: 'private-span' } },
      extra: { secret: 'value' },
      tags: { token: 'secret' },
      exception: {
        values: [{
          type: 'TypeError',
          value: 'private error message',
          stacktrace: { frames: [{ filename: '/private/path.js' }] },
        }],
      },
    };

    expect(sanitizeSentryEvent(event)).toEqual({
      type: undefined,
      event_id: 'abc123',
      level: 'error',
      platform: 'node',
      exception: {
        values: [{ type: 'TypeError', value: 'Unhandled server error' }],
      },
      tags: { request_id: requestId },
    });
  });

  it('replaces unsafe exception identifiers and drops malformed request IDs', () => {
    const event: ErrorEvent = {
      type: undefined,
      request: { headers: { 'x-request-id': 'not-a-uuid' } },
      exception: {
        values: [{ type: 'Private Error Name', value: 'secret' }],
      },
    };

    expect(sanitizeSentryEvent(event)).toEqual({
      type: undefined,
      level: 'error',
      platform: 'node',
      exception: {
        values: [{ type: 'Error', value: 'Unhandled server error' }],
      },
      tags: {},
    });
  });

  it('provides a safe error identifier when the SDK event has no exception values', () => {
    expect(sanitizeSentryEvent({ type: undefined })).toMatchObject({
      exception: { values: [{ type: 'Error', value: 'Unhandled server error' }] },
      tags: {},
    });
  });
});
