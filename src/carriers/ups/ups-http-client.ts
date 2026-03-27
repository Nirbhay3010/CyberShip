import type { HttpClient, HttpRequestConfig, HttpResponse } from "../../http/http-client.js";
import type { UpsAuthManager } from "./ups-auth.js";

export class UpsHttpClient {
  constructor(
    private readonly httpClient: HttpClient,
    private readonly authManager: UpsAuthManager,
  ) {}

  async request<T = unknown>(config: HttpRequestConfig): Promise<HttpResponse<T>> {
    const token = await this.authManager.getAccessToken();
    const response = await this.httpClient.request<T>(this.withAuth(config, token));

    if (response.status === 401) {
      // Invalidate stale token and retry once with a fresh one
      this.authManager.invalidateToken();
      const freshToken = await this.authManager.getAccessToken();
      return this.httpClient.request<T>(this.withAuth(config, freshToken));
    }

    return response;
  }

  private withAuth(config: HttpRequestConfig, token: string): HttpRequestConfig {
    return {
      ...config,
      headers: {
        "Content-Type": "application/json",
        ...config.headers,
        Authorization: `Bearer ${token}`,
      },
    };
  }
}
