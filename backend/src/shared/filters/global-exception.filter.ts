import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { PinoLogger } from 'nestjs-pino';
import { AuthRequestLimitException } from '../../auth/request-limits.service';

interface ErrorResponse {
  statusCode: number;
  message: string;
  error: string;
  timestamp: string;
  path: string;
  // The operation a refused accounting change would leave short (409 only).
  dependent?: Record<string, unknown>;
}

// A 409 may name the later operation it protects so the client can say which one.
// Only that plain object passes through; every other response field stays dropped.
function conflictDependent(status: number, value: unknown) {
  if (status !== HttpStatus.CONFLICT) return undefined;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

@Injectable()
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  constructor(private readonly logger: PinoLogger) {
    this.logger.setContext(GlobalExceptionFilter.name);
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    if (exception instanceof AuthRequestLimitException) {
      response.setHeader('Retry-After', String(exception.retryAfter));
      response.setHeader('Cache-Control', 'no-store');
    }

    const { status, message, error, dependent } = this.getErrorDetails(exception);

    const errorResponse: ErrorResponse = {
      statusCode: status,
      message,
      error,
      timestamp: new Date().toISOString(),
      path: request.url.split('?')[0],
      ...(dependent ? { dependent } : {}),
    };

    // Log error with context
    this.logError(exception, request, status);

    response.status(status).json(errorResponse);
  }

  private getErrorDetails(exception: unknown): {
    status: number;
    message: string;
    error: string;
    dependent?: Record<string, unknown>;
  } {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      let message: string;
      let error: string;
      let dependent: Record<string, unknown> | undefined;

      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
        error = exception.name;
      } else if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
        const responseObj = exceptionResponse as Record<string, unknown>;
        message = Array.isArray(responseObj.message)
          ? responseObj.message.join(', ')
          : (responseObj.message as string) || exception.message;
        error = (responseObj.error as string) || exception.name;
        dependent = conflictDependent(status, responseObj.dependent);
      } else {
        message = exception.message;
        error = exception.name;
      }

      // Nest's default unmatched-route message includes the complete request URL.
      return { status, message: status === 404 ? 'Not Found' : message, error, dependent };
    }

    // Express's body parser reports this before Nest can create an HttpException.
    // Recognize only its size refusal; never reflect submitted content or parser details.
    if (
      exception instanceof Error &&
      'type' in exception &&
      exception.type === 'entity.too.large' &&
      'status' in exception &&
      exception.status === HttpStatus.PAYLOAD_TOO_LARGE
    ) {
      return {
        status: HttpStatus.PAYLOAD_TOO_LARGE,
        message: 'Payload too large',
        error: 'PayloadTooLargeError',
      };
    }

    // Handle non-HTTP exceptions
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Internal server error',
      error: 'InternalServerError',
    };
  }

  private logError(exception: unknown, request: Request, status: number): void {
    const logContext = {
      statusCode: status,
      method: request.method,
      url: request.url.split('?')[0],
      ip: request.ip,
    };

    if (status >= 500) {
      this.logger.error(
        {
          ...logContext,
          errorType: exception instanceof Error ? exception.name : 'UnknownError',
        },
        'Server error occurred',
      );
    } else if (status >= 400) {
      this.logger.warn(
        {
          ...logContext,
          errorType: exception instanceof Error ? exception.name : 'UnknownError',
        },
        'Client error occurred',
      );
    }
  }
}
