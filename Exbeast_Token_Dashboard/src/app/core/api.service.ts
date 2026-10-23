import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';
import { ApiResponse } from './models';

/** Error with the backend's message (and data, e.g. google2fa_required). */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly data: unknown = null,
  ) {
    super(message);
  }
}

type Query = Record<string, string | number | boolean | null | undefined>;

/** Thin promise wrapper over the token owner API; returns `data` of the response. */
@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);
  readonly base = environment.apiUrl;

  get<T>(path: string, query?: Query): Promise<T> {
    return this.run(this.http.get<ApiResponse<T>>(this.base + path, { params: this.params(query) }));
  }

  post<T>(path: string, body: unknown = {}): Promise<T> {
    return this.run(this.http.post<ApiResponse<T>>(this.base + path, body));
  }

  put<T>(path: string, body: unknown = {}): Promise<T> {
    return this.run(this.http.put<ApiResponse<T>>(this.base + path, body));
  }

  delete<T>(path: string): Promise<T> {
    return this.run(this.http.delete<ApiResponse<T>>(this.base + path));
  }

  /** Same as post but keeps the message (for "Invitation sent" vs "Member added"). */
  async postWithMessage<T>(path: string, body: unknown = {}): Promise<{ data: T; message: string }> {
    try {
      const res = await firstValueFrom(this.http.post<ApiResponse<T>>(this.base + path, body));
      return { data: res.data, message: res.message };
    } catch (e) {
      throw this.toError(e);
    }
  }

  private async run<T>(req: ReturnType<HttpClient['get']>): Promise<T> {
    try {
      const res = (await firstValueFrom(req)) as ApiResponse<T>;
      return res.data;
    } catch (e) {
      throw this.toError(e);
    }
  }

  private toError(e: unknown): ApiError {
    if (e instanceof HttpErrorResponse) {
      const body = e.error as Partial<ApiResponse<unknown>> | null;
      const message =
        body?.message ||
        (e.status === 0 ? 'Cannot reach the server. Check your connection.' : `Request failed (${e.status}).`);
      return new ApiError(message, e.status, body?.data ?? null);
    }
    return new ApiError('Something went wrong.', 0);
  }

  private params(query?: Query): HttpParams {
    let p = new HttpParams();
    for (const [k, v] of Object.entries(query ?? {})) {
      if (v !== null && v !== undefined && v !== '') {
        p = p.set(k, String(v));
      }
    }
    return p;
  }
}
