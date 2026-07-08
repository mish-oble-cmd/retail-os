import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import * as Sentry from '@sentry/node';
import session from 'express-session';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { ProblemJsonFilter } from './common/problem-json.filter';

async function bootstrap(): Promise<void> {
  // Sentry is wired but inert until SENTRY_DSN is provided (pending credentials).
  if (process.env['SENTRY_DSN']) {
    Sentry.init({
      dsn: process.env['SENTRY_DSN'],
      environment: process.env['NODE_ENV'] ?? 'development',
    });
  }

  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new ProblemJsonFilter());

  const isProduction = process.env['NODE_ENV'] === 'production';
  if (isProduction && !process.env['SESSION_SECRET']) {
    throw new Error('SESSION_SECRET must be set in production');
  }
  app.use(
    session({
      // MemoryStore is Phase 0 only; the Redis store lands with real deploys (tech-stack.md).
      secret: process.env['SESSION_SECRET'] ?? 'dev-only-secret',
      name: 'retailos.sid',
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: isProduction,
        maxAge: 1000 * 60 * 60 * 12,
      },
    }),
  );

  const port = Number(process.env['PORT'] ?? 3001);
  await app.listen(port);
}

void bootstrap();
