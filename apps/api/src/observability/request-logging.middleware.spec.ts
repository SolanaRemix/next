import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { createRequestLoggingMiddleware } from './request-logging.middleware.js';

function createResponse() {
  const response = new EventEmitter() as EventEmitter & {
    statusCode: number;
    setHeader: ReturnType<typeof vi.fn>;
  };
  response.statusCode = 200;
  response.setHeader = vi.fn();
  return response;
}

describe('request logging middleware', () => {
  it('accepts a valid upstream UUID, returns it, and logs only path and response metadata', () => {
    const response = createResponse();
    const request = {
      get: vi.fn().mockReturnValue('C15C090E-2615-4E52-AD67-F212A4154074'),
      method: 'GET',
      path: '/api/audit',
      originalUrl: '/api/audit?actorEmail=private@example.com',
    };
    const writeLog = vi.fn();
    const next = vi.fn();

    createRequestLoggingMiddleware(writeLog)(
      request as unknown as Request,
      response as unknown as Response,
      next as NextFunction,
    );
    response.emit('finish');

    expect(response.setHeader).toHaveBeenCalledWith(
      'X-Request-Id',
      'c15c090e-2615-4e52-ad67-f212a4154074',
    );
    expect(next).toHaveBeenCalledOnce();
    expect(writeLog).toHaveBeenCalledWith(expect.objectContaining({
      level: 'info',
      message: 'http.request.completed',
      requestId: 'c15c090e-2615-4e52-ad67-f212a4154074',
      method: 'GET',
      path: '/api/audit',
      statusCode: 200,
    }));
    const logged = JSON.stringify(writeLog.mock.calls);
    expect(logged).not.toContain('actorEmail');
    expect(logged).not.toContain('private@example.com');
  });

  it('replaces malformed request IDs and assigns warning/error levels by status', () => {
    const response = createResponse();
    response.statusCode = 503;
    const request = {
      get: vi.fn().mockReturnValue('bad-id\nforged-log-entry'),
      method: 'POST',
      path: '/api/swaps/evm/execute',
    };
    const writeLog = vi.fn();

    createRequestLoggingMiddleware(writeLog)(
      request as unknown as Request,
      response as unknown as Response,
      vi.fn(),
    );
    response.emit('finish');

    const generatedId = response.setHeader.mock.calls[0]?.[1];
    expect(generatedId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(writeLog).toHaveBeenCalledWith(expect.objectContaining({
      level: 'error',
      requestId: generatedId,
      statusCode: 503,
    }));
    expect(JSON.stringify(writeLog.mock.calls)).not.toContain('forged-log-entry');
  });

  it('uses warning level for client errors', () => {
    const response = createResponse();
    response.statusCode = 429;
    const writeLog = vi.fn();

    createRequestLoggingMiddleware(writeLog)(
      { get: () => undefined, method: 'GET', path: '/api/health/ready' } as unknown as Request,
      response as unknown as Response,
      vi.fn(),
    );
    response.emit('finish');

    expect(writeLog).toHaveBeenCalledWith(expect.objectContaining({
      level: 'warn',
      statusCode: 429,
    }));
  });
});
