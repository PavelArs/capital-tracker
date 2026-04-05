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

interface ErrorResponse {
  statusCode: number;
  message: string;
  error: string;
  timestamp: string;
  path: string;
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

    const { status, message, error } = this.getErrorDetails(exception);

    const errorResponse: ErrorResponse = {
      statusCode: status,
      message,
      error,
      timestamp: new Date().toISOString(),
      path: request.url,
    };

    // Log error with context
    this.logError(exception, request, status);

    response.status(status).json(errorResponse);
  }

  private getErrorDetails(exception: unknown): {
    status: number;
    message: string;
    error: string;
  } {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      let message: string;
      let error: string;

      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
        error = exception.name;
      } else if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
        const responseObj = exceptionResponse as Record<string, unknown>;
        message = Array.isArray(responseObj.message)
          ? responseObj.message.join(', ')
          : (responseObj.message as string) || exception.message;
        error = (responseObj.error as string) || exception.name;
      } else {
        message = exception.message;
        error = exception.name;
      }

      return { status, message, error };
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
      url: request.url,
      userAgent: request.get('User-Agent'),
      ip: request.ip,
    };

    if (status >= 500) {
      this.logger.error(
        {
          ...logContext,
          error: exception instanceof Error ? exception.stack : String(exception),
        },
        'Server error occurred',
      );
    } else if (status >= 400) {
      this.logger.warn(
        {
          ...logContext,
          message: exception instanceof Error ? exception.message : String(exception),
        },
        'Client error occurred',
      );
    }
  }
}
