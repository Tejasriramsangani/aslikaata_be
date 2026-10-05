import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response, Request } from 'express';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'An unexpected internal error occurred';
    let details: any = null;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();
      if (typeof res === 'string') {
        message = res;
      } else if (typeof res === 'object' && res !== null) {
        message = (res as any).message || exception.message;
        details = (res as any).errors || (res as any).details || null;
      }
    } else if (typeof exception === 'object' && exception !== null) {
      const err = exception as any;
      if (err.name === 'ValidationError') {
        // Mongoose validation error
        status = HttpStatus.BAD_REQUEST;
        message = 'Validation error occurred';
        details = Object.keys(err.errors || {}).map((field) => ({
          field,
          message: err.errors[field].message,
        }));
      } else if (err.code === 11000) {
        // Mongo duplicate key error
        status = HttpStatus.CONFLICT;
        const field = Object.keys(err.keyPattern || {})[0] || 'record';
        message = `A record with this ${field} already exists.`;
      } else {
        this.logger.error(`Unhandled Exception at ${request.method} ${request.url}:`, err);
      }
    }

    response.status(status).json({
      success: false,
      data: null,
      error: {
        statusCode: status,
        message,
        details,
        path: request.url,
      },
      timestamp: new Date().toISOString(),
    });
  }
}
