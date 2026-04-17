const API_BASE_URL = __DEV__
  ? 'http://10.0.2.2:3000'
  : 'https://your-api-domain.com';

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  body?: any;
  headers?: Record<string, string>;
}

class ApiClient {
  private baseUrl: string;

  constructor() {
    this.baseUrl = API_BASE_URL;
  }

  private async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { method = 'GET', body, headers = {} } = options;

    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      throw new Error(`API Error: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  get<T>(path: string) {
    return this.request<T>(path);
  }

  post<T>(path: string, body?: any) {
    return this.request<T>(path, { method: 'POST', body });
  }

  put<T>(path: string, body?: any) {
    return this.request<T>(path, { method: 'PUT', body });
  }

  delete<T>(path: string) {
    return this.request<T>(path, { method: 'DELETE' });
  }

  patch<T>(path: string, body?: any) {
    return this.request<T>(path, { method: 'PATCH', body });
  }
}

export const apiClient = new ApiClient();
export { API_BASE_URL };
