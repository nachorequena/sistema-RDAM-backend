import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export interface RdamResponse<T> {
  data: T;
  message?: string;
}

@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<T, RdamResponse<T>> {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<RdamResponse<T>> {
    return next.handle().pipe(
      map((data) => {
        // Si el handler ya devuelve { data, message }, respetarlo
        if (data && typeof data === 'object' && 'data' in data) return data;
        return { data };
      }),
    );
  }
}
