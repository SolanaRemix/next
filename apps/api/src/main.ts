import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module.js';
import { createRequestLoggingMiddleware } from './observability/request-logging.middleware.js';
import { startTelemetry } from './observability/telemetry.js';
import { validateEnvironment } from './config/environment.js';

async function bootstrap(): Promise<void> {
  validateEnvironment(process.env);
  await startTelemetry();
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');
  app.use(createRequestLoggingMiddleware());
  app.use(cookieParser());
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  }));
  app.enableCors({
    origin: process.env.WEB_ORIGIN ?? 'http://localhost:5173',
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id', 'traceparent', 'tracestate'],
    exposedHeaders: ['X-Request-Id'],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });
  app.enableShutdownHooks();
  const port = Number(process.env.PORT ?? 3001);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535.');
  }
  await app.listen(port);
}
await bootstrap();
