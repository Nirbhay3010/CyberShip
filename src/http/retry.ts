import { NetworkError, TimeoutError } from "../domain/errors.js";
import type { HttpClient, HttpRequestConfig, HttpResponse } from "./http-client.js";

export interface RetryConfig {
  /** Maximum number of retry attempts (default: 3) */
  maxRetries: number;
  /** Initial delay in ms before first retry (default: 500) */
  baseDelayMs: number;
  /** Maximum delay cap in ms (default: 10000) */
  maxDelayMs: number;
  /** Multiplier applied after each attempt (default: 2) */
  backoffMultiplier: number;
  /** Add random jitter ±25% to prevent thundering herd (default: true) */
  jitter: boolean;
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 500,
  maxDelayMs: 10_000,
  backoffMultiplier: 2,
  jitter: true,
};

/**
 * Wraps any HttpClient with automatic retry + exponential backoff.
 *
 * Retries on:
 *  - 5xx server errors
 *  - 429 rate-limit (respects Retry-After header when present)
 *  - Network errors (connection refused, DNS failure)
 *  - Timeout errors
 *
 * Does NOT retry:
 *  - 4xx client errors (except 429)
 *  - Authentication errors (401/403) — handled by UpsHttpClient's token-refresh logic
 */
export class RetryableHttpClient implements HttpClient {
  private readonly config: RetryConfig;

  constructor(
    private readonly inner: HttpClient,
    config: Partial<RetryConfig> = {},
  ) {
    this.config = { ...DEFAULT_RETRY_CONFIG, ...config };
  }

  async request<T = unknown>(requestConfig: HttpRequestConfig): Promise<HttpResponse<T>> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        const response = await this.inner.request<T>(requestConfig);

        if (this.isRetryableStatus(response.status) && attempt < this.config.maxRetries) {
          const delay = this.resolveDelay(attempt, response);
          await this.sleep(delay);
          continue;
        }

        return response;
      } catch (error) {
        lastError = error;

        if (!this.isRetryableError(error) || attempt >= this.config.maxRetries) {
          throw error;
        }

        const delay = this.resolveDelay(attempt);
        await this.sleep(delay);
      }
    }

    // Should not be reachable, but satisfies TypeScript
    throw lastError;
  }

  private isRetryableStatus(status: number): boolean {
    return status === 429 || status >= 500;
  }

  private isRetryableError(error: unknown): boolean {
    return error instanceof NetworkError || error instanceof TimeoutError;
  }

  private resolveDelay(attempt: number, response?: HttpResponse): number {
    // Respect Retry-After header for 429 responses
    if (response?.status === 429) {
      const retryAfter = response.headers["retry-after"];
      if (retryAfter) {
        const seconds = parseInt(retryAfter, 10);
        if (!isNaN(seconds) && seconds > 0) {
          return Math.min(seconds * 1000, this.config.maxDelayMs);
        }
      }
    }

    const exponentialDelay = this.config.baseDelayMs * Math.pow(this.config.backoffMultiplier, attempt);
    const capped = Math.min(exponentialDelay, this.config.maxDelayMs);

    if (!this.config.jitter) return capped;

    // ±25% jitter
    const jitterRange = capped * 0.25;
    return capped - jitterRange + Math.random() * jitterRange * 2;
  }

  /** Exposed for test override */
  protected sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
