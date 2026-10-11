import * as Sentry from '@sentry/nestjs';
import type { ErrorEvent } from '@sentry/nestjs';

const requestIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const safeErrorTypePattern = /^[A-Za-z][A-Za-z0-9_$]{0,63}$/;

function getRequestId(requestId: string | undefined): string | undefined {
  return requestId && requestIdPattern.test(requestId) ? requestId.toLowerCase() : undefined;
}

function getRequestIdFromHeaders(headers: Record<string, string> | undefined): string | undefined {
  if (!headers) return undefined;
  const requestId = Object.entries(headers)
    .find(([name]) => name.toLowerCase() === 'x-request-id')?.[1];
  return getRequestId(requestId);
}

export function sanitizeSentryEvent(event: ErrorEvent): ErrorEvent {
  const requestId = getRequestId(
    typeof event.tags?.request_id === 'string' ? event.tags.request_id : undefined,
  )
    ?? getRequestIdFromHeaders(event.request?.headers);
  const exceptions = event.exception?.values ?? [];

  return {
    type: undefined,
    ...(event.event_id ? { event_id: event.event_id } : {}),
    ...(event.timestamp !== undefined ? { timestamp: event.timestamp } : {}),
    level: 'error',
    platform: 'node',
    exception: {
      values: exceptions.length > 0
        ? exceptions.slice(0, 5).map((exception) => ({
          type: exception.type && safeErrorTypePattern.test(exception.type) ? exception.type : 'Error',
          value: 'Unhandled server error',
        }))
        : [{ type: 'Error', value: 'Unhandled server error' }],
    },
    tags: requestId ? { request_id: requestId } : {},
  };
}

export function startSentry(dsn = process.env.SENTRY_DSN): void {
  if (!dsn) return;
  Sentry.init({
    dsn,
    sendDefaultPii: false,
    beforeSend: (event) => sanitizeSentryEvent(event),
    beforeBreadcrumb: () => null,
    maxBreadcrumbs: 0,
    tracesSampleRate: 0,
    skipOpenTelemetrySetup: true,
    registerEsmLoaderHooks: false,
    includeLocalVariables: false,
  });
}

export async function stopSentry(): Promise<void> {
  try {
    await Sentry.close(2_000);
  } catch {
    return;
  }
}
