import 'reflect-metadata';

import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import type { NextFunction, Request, Response } from 'express';

import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule, {
    // Webhook signature verification needs the byte-exact body — once Express
    // has parsed and re-serialised JSON, the signature no longer matches.
    rawBody: true,
    bufferLogs: true,
  });

  const isProduction = process.env.NODE_ENV === 'production';

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'https:'],
          connectSrc: ["'self'"],
          frameAncestors: ["'none'"], // clickjacking
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          ...(isProduction ? { upgradeInsecureRequests: [] } : {}),
        },
      },
      // Two years, preloadable. Any downgrade to HTTP on a financial app is a
      // session-stealing opportunity.
      hsts: { maxAge: 63_072_000, includeSubDomains: true, preload: true },
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
      crossOriginResourcePolicy: { policy: 'same-site' },
    }),
  );

  app.use(cookieParser(process.env.COOKIE_SECRET));

  // Every response carries a request id. Support can trace a user's complaint
  // to exact log lines and audit rows from the id shown in an error toast.
  app.use((req: Request & { requestId?: string }, res: Response, next: NextFunction) => {
    req.requestId = (req.headers['x-request-id'] as string) ?? crypto.randomUUID();
    res.setHeader('X-Request-Id', req.requestId);
    next();
  });

  // Strict allowlist — never a wildcard. Credentials are cookie-based, so a
  // permissive CORS policy would hand sessions to any origin that asks.
  const allowedOrigins = (process.env.CORS_ORIGINS ?? 'http://localhost:3000').split(',');
  app.enableCors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error(`Origin ${origin} is not allowed`), false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token', 'Idempotency-Key', 'X-Request-Id'],
    exposedHeaders: ['X-Request-Id'],
    maxAge: 86_400,
  });

  app.setGlobalPrefix('api/v1', { exclude: ['health', 'health/ready'] });
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // A JSON body larger than this is not a legitimate request to this API.
  app.use((req: Request, res: Response, next: NextFunction) => {
    const length = Number(req.headers['content-length'] ?? 0);
    if (length > 1_000_000) {
      return res.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request too large' } });
    }
    return next();
  });

  if (!isProduction) {
    const config = new DocumentBuilder()
      .setTitle('Evas API')
      .setDescription('Healthcare, retirement and digital services platform for Nigeria')
      .setVersion('1.0')
      .addBearerAuth()
      .addCookieAuth('__Host-evas_access')
      .build();
    SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, config));
    logger.log('API docs at /api/docs');
  }

  app.enableShutdownHooks();

  const port = Number(process.env.PORT ?? 4000);
  await app.listen(port, '0.0.0.0');
  logger.log(`Evas API listening on :${port}`);
}

void bootstrap();
