import { useAuthStore } from '@/stores/auth-store';

const API_BASE_URL = import.meta.env.VITE_API_URL || '/api/v1';

interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  params?: Record<string, string | number | boolean | undefined>;
}

class ApiClient {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  private buildUrl(path: string, params?: Record<string, string | number | boolean | undefined>): string {
    // Build path by joining baseUrl + path (handles relative base like '/api/v1')
    const base = this.baseUrl.endsWith('/') ? this.baseUrl.slice(0, -1) : this.baseUrl;
    const suffix = path.startsWith('/') ? path : `/${path}`;
    let fullUrl = `${base}${suffix}`;

    if (params) {
      const searchParams = new URLSearchParams();
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) {
          searchParams.set(key, String(value));
        }
      });
      const qs = searchParams.toString();
      if (qs) fullUrl += `?${qs}`;
    }
    return fullUrl;
  }

  private getAuthHeaders(): Record<string, string> {
    const token = useAuthStore.getState().token;
    if (token) {
      return { Authorization: `Bearer ${token}` };
    }
    return {};
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { body, params, ...init } = options;
    const url = this.buildUrl(path, params);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...this.getAuthHeaders(),
      ...(init.headers as Record<string, string>),
    };

    const response = await fetch(url, {
      ...init,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    // Auto-logout on 401 (token expired or invalid)
    if (response.status === 401) {
      const currentToken = useAuthStore.getState().token;
      // Only auto-logout if we had a token (not on login/register endpoints)
      if (currentToken && !path.startsWith('/auth/')) {
        useAuthStore.getState().logout();
      }
    }

    if (!response.ok) {
      const errorBody = await response.text().catch(() => 'Unknown error');
      throw new ApiError(response.status, response.statusText, errorBody);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return response.json();
  }

  get<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'GET', params });
  }

  post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>(path, { method: 'POST', body });
  }

  put<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>(path, { method: 'PUT', body });
  }

  patch<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>(path, { method: 'PATCH', body });
  }

  delete<T>(path: string): Promise<T> {
    return this.request<T>(path, { method: 'DELETE' });
  }
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public statusText: string,
    public body: string,
  ) {
    super(`API Error ${status}: ${statusText}`);
    this.name = 'ApiError';
  }
}

export const apiClient = new ApiClient(API_BASE_URL);
