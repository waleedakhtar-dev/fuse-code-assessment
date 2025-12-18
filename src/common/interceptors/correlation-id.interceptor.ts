import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { v4 as uuid } from 'uuid';
import { tap } from 'rxjs/operators';

@Injectable()
export class CorrelationIdInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const ctx = context.switchToHttp();
    const request = ctx.getRequest<Request & { id?: string }>();
    const response = ctx.getResponse();

    const existingId =
      (request.headers['x-request-id'] as string | undefined) || request['id'];
    const correlationId = existingId || uuid();

    // attach to request and response header for logging/tracing
    (request as any).correlationId = correlationId;
    response.setHeader('X-Request-ID', correlationId);

    return next.handle().pipe(
      tap(() => {
        // here we could also log with correlation id if needed
      }),
    );
  }
}


