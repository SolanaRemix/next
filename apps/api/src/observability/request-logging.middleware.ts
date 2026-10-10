import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

const requestIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface HttpRequestLog {
  level: 'info' | 'warn' | 'error';
  message: 'http.request.completed';
  requestId: string;
  method: string;
  path: string;
  statusCode: number;
  durationMs: number;
}

type StructuredLogWriter = (entry: HttpRequestLog) => void;

export function createRequestLoggingMiddleware(
  writeLog: StructuredLogWriter = (entry) => console.log(JSON.stringify(entry)),
) {
  return (request: Request, response: Response, next: NextFunction): void => {
    const suppliedId = request.get('x-request-id');
    const requestId = suppliedId && requestIdPattern.test(suppliedId)
      ? suppliedId.toLowerCase()
      : randomUUID();
    const startedAt = process.hrtime.bigint();

    response.setHeader('X-Request-Id', requestId);
    response.on('finish', () => {
      const statusCode = response.statusCode;
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      writeLog({
        level: statusCode >= 500 ? 'error' : statusCode >= 400 ? 'warn' : 'info',
        message: 'http.request.completed',
        requestId,
        method: request.method,
        path: request.path,
        statusCode,
        durationMs: Math.round(durationMs * 100) / 100,
      });
    });

    next();
  };
}
