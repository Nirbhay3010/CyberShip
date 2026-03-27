import { NetworkError, TimeoutError } from "../domain/errors.js";

export interface HttpRequestConfig {
  url: string;
  method: "GET" | "POST" | "PUT" | "DELETE";
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
  formEncoded?: boolean;
}

export interface HttpResponse<T = unknown> {
  status: number;
  headers: Record<string, string>;
  data: T;
}

export interface HttpClient {
  request<T = unknown>(config: HttpRequestConfig): Promise<HttpResponse<T>>;
}

export class FetchHttpClient implements HttpClient {
  constructor(private readonly carrierName: string = "unknown") {}

  async request<T = unknown>(config: HttpRequestConfig): Promise<HttpResponse<T>> {
    const { url, method, headers = {}, body, timeoutMs, formEncoded } = config;

    const controller = new AbortController();
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    if (timeoutMs) {
      timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    }

    let requestBody: string | undefined;
    const requestHeaders = { ...headers };

    if (body !== undefined) {
      if (formEncoded && typeof body === "object" && body !== null) {
        requestBody = new URLSearchParams(body as Record<string, string>).toString();
        requestHeaders["Content-Type"] ??= "application/x-www-form-urlencoded";
      } else {
        requestBody = JSON.stringify(body);
        requestHeaders["Content-Type"] ??= "application/json";
      }
    }

    try {
      const response = await fetch(url, {
        method,
        headers: requestHeaders,
        body: requestBody,
        signal: controller.signal,
      });

      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });

      let data: T;
      const contentType = response.headers.get("content-type") ?? "";
      if (contentType.includes("application/json")) {
        data = (await response.json()) as T;
      } else {
        data = (await response.text()) as T;
      }

      return { status: response.status, headers: responseHeaders, data };
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new TimeoutError(this.carrierName, `Request to ${url} timed out after ${timeoutMs}ms`);
      }
      throw new NetworkError(
        this.carrierName,
        `Request to ${url} failed: ${error instanceof Error ? error.message : String(error)}`,
        error,
      );
    } finally {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
    }
  }
}
