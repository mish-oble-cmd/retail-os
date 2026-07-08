import {
  Catch,
  HttpException,
  HttpStatus,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Response } from 'express';
import { ZodError } from 'zod';

/**
 * RFC 9457 problem+json error envelope (api-design.md §Conventions):
 * { type, title, status, detail, errors: [{field, code, message}] }
 */
@Catch()
export class ProblemJsonFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    if (exception instanceof ZodError) {
      response
        .status(400)
        .type('application/problem+json')
        .json({
          type: 'https://retailos.dev/problems/validation',
          title: 'Validation failed',
          status: 400,
          detail: 'One or more fields are invalid.',
          errors: exception.issues.map((issue) => ({
            field: issue.path.join('.'),
            code: issue.code,
            message: issue.message,
          })),
        });
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      response.status(status).type('application/problem+json').json({
        type: 'about:blank',
        title: exception.message,
        status,
      });
      return;
    }

    // Unknown error: log loudly, reveal nothing (pino picks this up via stderr hook).
    console.error(exception);
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).type('application/problem+json').json({
      type: 'about:blank',
      title: 'Internal server error',
      status: 500,
    });
  }
}
