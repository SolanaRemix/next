import { describe, expect, it } from 'vitest';
import { toOtlpTraceEndpoint } from './telemetry.js';

describe('toOtlpTraceEndpoint', () => {
  it('appends the OTLP traces path to an HTTP collector base URL', () => {
    expect(toOtlpTraceEndpoint('https://collector.example/otel/'))
      .toBe('https://collector.example/otel/v1/traces');
  });

  it('preserves an explicit traces endpoint', () => {
    expect(toOtlpTraceEndpoint('https://collector.example/v1/traces'))
      .toBe('https://collector.example/v1/traces');
  });
});
