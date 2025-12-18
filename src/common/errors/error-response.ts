import { HttpException, HttpStatus } from '@nestjs/common';

export interface ErrorBody {
  error: {
    code: string;
    message: string;
    timestamp: string;
    path: string;
    details?: Record<string, any>;
  };
}

export class DomainHttpException extends HttpException {
  constructor(
    code: string,
    message: string,
    status: HttpStatus,
    path: string,
    details?: Record<string, any>,
  ) {
    super(
      {
        error: {
          code,
          message,
          timestamp: new Date().toISOString(),
          path,
          details,
        },
      } as ErrorBody,
      status,
    );
  }
}


