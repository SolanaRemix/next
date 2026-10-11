import { Catch, HttpException } from '@nestjs/common';
import { BaseExceptionFilter, HttpAdapterHost } from '@nestjs/core';
import type { ArgumentsHost } from '@nestjs/common';
import type { Response } from 'express';
import { captureException, withScope } from '@sentry/nestjs';

const requestIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUnexpectedSentryException(exception: unknown): boolean {
  return !(exception instanceof HttpException) || exception.getStatus() >= 500;
}

@Catch()
export class SentryExceptionFilter extends BaseExceptionFilter {
  constructor(adapterHost: HttpAdapterHost) {
    super(adapterHost.httpAdapter);
  }

  override catch(exception: unknown, host: ArgumentsHost): void {
    if (host.getType() === 'http' && isUnexpectedSentryException(exception)) {
      const response = host.switchToHttp().getResponse<Response>();
      const requestId = response.getHeader('X-Request-Id');
      withScope((scope) => {
        if (typeof requestId === 'string' && requestIdPattern.test(requestId)) {
          scope.setTag('request_id', requestId.toLowerCase());
        }
        captureException(exception);
      });
    }
    super.catch(exception, host);
  }
}
