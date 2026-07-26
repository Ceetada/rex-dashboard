import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';

interface ErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
    requestId?: string;
  };
}

/**
 * Turns every thrown thing into one predictable envelope.
 *
 * The rule that matters: internal detail never reaches the client. A Prisma
 * error string leaks table and column names; a stack trace leaks file paths.
 * Both go to the log with the request id attached, and the client gets a
 * generic message plus that id — enough for support to find the real error
 * without handing an attacker a map of the schema.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request & { requestId?: string }>();
    const requestId = request.requestId;

    const { status, body } = this.translate(exception, requestId);

    if (status >= 500) {
      this.logger.error(
        `[${requestId}] ${request.method} ${request.url} -> ${status}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    } else if (status === 401 || status === 403) {
      // Auth failures are security-relevant even at 4xx.
      this.logger.warn(`[${requestId}] ${request.method} ${request.url} -> ${status} ${body.error.code}`);
    }

    response.status(status).json(body);
  }

  private translate(exception: unknown, requestId?: string): { status: number; body: ErrorBody } {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();

      if (typeof payload === 'object' && payload !== null && 'code' in payload) {
        const { code, message, ...details } = payload as Record<string, unknown>;
        return {
          status,
          body: {
            error: {
              code: String(code),
              message: String(message ?? exception.message),
              ...(Object.keys(details).length ? { details } : {}),
              ...(requestId ? { requestId } : {}),
            },
          },
        };
      }

      // Nest's built-in shape (e.g. from ValidationPipe).
      const message =
        typeof payload === 'string'
          ? payload
          : ((payload as { message?: string | string[] }).message ?? exception.message);
      return {
        status,
        body: {
          error: {
            code: this.codeForStatus(status),
            message: Array.isArray(message) ? message[0]! : message,
            ...(Array.isArray(message) ? { details: { fields: message } } : {}),
            ...(requestId ? { requestId } : {}),
          },
        },
      };
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      // Translate only the codes that correspond to a real client mistake.
      // Everything else is a 500 — the client cannot act on it anyway.
      if (exception.code === 'P2002') {
        return {
          status: HttpStatus.CONFLICT,
          body: {
            error: {
              code: 'ALREADY_EXISTS',
              message: 'That record already exists',
              ...(requestId ? { requestId } : {}),
            },
          },
        };
      }
      if (exception.code === 'P2025') {
        return {
          status: HttpStatus.NOT_FOUND,
          body: {
            error: { code: 'NOT_FOUND', message: 'Not found', ...(requestId ? { requestId } : {}) },
          },
        };
      }
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      body: {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Something went wrong on our side. Please try again.',
          ...(requestId ? { requestId } : {}),
        },
      },
    };
  }

  private codeForStatus(status: number): string {
    const map: Record<number, string> = {
      400: 'BAD_REQUEST',
      401: 'UNAUTHORIZED',
      403: 'FORBIDDEN',
      404: 'NOT_FOUND',
      409: 'CONFLICT',
      422: 'UNPROCESSABLE',
      429: 'RATE_LIMITED',
    };
    return map[status] ?? 'ERROR';
  }
}
