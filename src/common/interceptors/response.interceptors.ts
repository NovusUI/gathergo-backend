// src/common/interceptors/response.interceptor.ts

import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { map } from 'rxjs/operators';
import { Observable } from 'rxjs';

@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    return next.handle().pipe(
      map((data) => {
        // If the response has pagination fields, format it as paginated
        if (
          data &&
          typeof data === 'object' &&
          'page' in data &&
          'pageSize' in data &&
          'total' in data
        ) {
          return {
            status: 'success',
            message: data?.message || 'Request successful',
            meta: {
              page: data.page,
              pageSize: data.pageSize,
              total: data.total,
              hasNextPage: data.page * data.pageSize < data.total,
            },
            data: data.data ?? [],
          };
        }

        // Default (non-paginated) response
        return {
          status: 'success',
          message: data?.message || 'Request successful',
          data: data?.data ?? data,
        };
      }),
    );
  }
}

  