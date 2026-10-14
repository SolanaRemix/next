import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';

let sdk: NodeSDK | null = null;

export function toOtlpTraceEndpoint(endpoint: string): string {
  const parsed = new URL(endpoint);
  const path = parsed.pathname.replace(/\/+$/, '');
  parsed.pathname = path.endsWith('/v1/traces') ? path : `${path}/v1/traces`;
  return parsed.toString();
}

export async function startTelemetry(
  endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
  serviceName = process.env.OTEL_SERVICE_NAME || 'mega-gods-prompt-next-api',
): Promise<void> {
  if (sdk || !endpoint) return;
  sdk = new NodeSDK({
    serviceName,
    traceExporter: new OTLPTraceExporter({ url: toOtlpTraceEndpoint(endpoint) }),
    instrumentations: [],
  });
  try {
    await sdk.start();
  } catch (error) {
    sdk = null;
    throw error;
  }
}

export async function stopTelemetry(): Promise<void> {
  const activeSdk = sdk;
  sdk = null;
  if (activeSdk) await activeSdk.shutdown();
}
