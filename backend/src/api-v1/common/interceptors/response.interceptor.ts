import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

import { Response } from 'express';

export interface WrappedResponse<T> {
  code: number;
  data: T;
  message: string;
}

@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<T, WrappedResponse<T | null>> {
  intercept(context: ExecutionContext, next: CallHandler): Observable<WrappedResponse<T | null>> {
    const response = context.switchToHttp().getResponse<Response>();

    // 跳过 SSE 流式响应（手动控制 Response）
    const contentType = response.getHeader('Content-Type');
    if (contentType === 'text/event-stream') {
      return next.handle();
    }

    return next.handle().pipe(
      map((data) => ({
        code: response.statusCode || 200,
        data,
        message: 'success',
      })),
    );
  }
}