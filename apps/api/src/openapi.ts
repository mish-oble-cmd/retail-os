import 'reflect-metadata';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { stringify } from 'yaml';
import { AppModule } from './app.module';

/**
 * OpenAPI generation pipeline (phase-0-foundations.md §0.4): boots the app
 * without listening, emits openapi/v1.yaml, which @retailos/api-client codegen
 * consumes. CI regenerates and fails on drift (monorepo rule 5: codegen is
 * one-way).
 */
async function generate(): Promise<void> {
  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix('api/v1');

  const config = new DocumentBuilder()
    .setTitle('RetailOS API')
    .setDescription(
      'REST API per 03-architecture/api-design.md. Internal clients are the first consumers; public from Phase 5.',
    )
    .setVersion('1.0.0-phase0')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  const out = join(__dirname, '..', 'openapi', 'v1.yaml');
  writeFileSync(out, stringify(document));
  await app.close();
  console.log(`OpenAPI written to ${out}`);
}

void generate();
