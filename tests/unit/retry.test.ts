import { describe, it, expect, vi } from "vitest";
import { RetryableHttpClient, DEFAULT_RETRY_CONFIG } from "../../src/http/retry.js";
import type { HttpClient, HttpRequestConfig, HttpResponse } from "../../src/http/http-client.js";
import { NetworkError, TimeoutError, ValidationError } from "../../src/domain/errors.js";

// Subclass that records sleep calls instead of actually sleeping
class TestableRetryClient extends RetryableHttpClient {
  public sleepCalls: number[] = [];

  protected override sleep(ms: number): Promise<void> {
    this.sleepCalls.push(ms);
    return Promise.resolve();
  }
}

function makeInner(responses: Array<HttpResponse | Error>): HttpClient & { callCount: number } {
  let callIndex = 0;
  return {
    callCount: 0,
    async request<T>(_config: HttpRequestConfig): Promise<HttpResponse<T>> {
      const idx = callIndex++;
      (this as any).callCount = idx + 1;
      const item = responses[idx] ?? responses[responses.length - 1];
      if (item instanceof Error) throw item;
      return item as HttpResponse<T>;
    },
  };
}

function ok(data: unknown = {}): HttpResponse {
  return { status: 200, headers: {}, data };
}

function serverError(data: unknown = {}): HttpResponse {
  return { status: 500, headers: {}, data };
}

function rateLimited(retryAfter?: string): HttpResponse {
  const headers: Record<string, string> = {};
  if (retryAfter) headers["retry-after"] = retryAfter;
  return { status: 429, headers, data: {} };
}

function badRequest(): HttpResponse {
  return { status: 400, headers: {}, data: {} };
}

const config: HttpRequestConfig = { url: "https://example.com", method: "POST" };

describe("RetryableHttpClient", () => {
  describe("successful requests", () => {
    it("returns immediately on 200", async () => {
      const inner = makeInner([ok({ result: "good" })]);
      const client = new TestableRetryClient(inner);

      const res = await client.request(config);

      expect(res.status).toBe(200);
      expect(res.data).toEqual({ result: "good" });
      expect(inner.callCount).toBe(1);
      expect(client.sleepCalls).toHaveLength(0);
    });

    it("does not retry 2xx responses", async () => {
      const inner = makeInner([{ status: 201, headers: {}, data: {} }]);
      const client = new TestableRetryClient(inner);

      const res = await client.request(config);

      expect(res.status).toBe(201);
      expect(inner.callCount).toBe(1);
    });
  });

  describe("server error (5xx) retries", () => {
    it("retries on 500 and succeeds on second attempt", async () => {
      const inner = makeInner([serverError(), ok({ recovered: true })]);
      const client = new TestableRetryClient(inner, { jitter: false });

      const res = await client.request(config);

      expect(res.status).toBe(200);
      expect(res.data).toEqual({ recovered: true });
      expect(inner.callCount).toBe(2);
      expect(client.sleepCalls).toHaveLength(1);
      expect(client.sleepCalls[0]).toBe(500); // baseDelayMs * 2^0
    });

    it("returns 500 after exhausting all retries", async () => {
      const inner = makeInner([serverError(), serverError(), serverError(), serverError()]);
      const client = new TestableRetryClient(inner, { maxRetries: 3, jitter: false });

      const res = await client.request(config);

      expect(res.status).toBe(500);
      expect(inner.callCount).toBe(4); // 1 initial + 3 retries
      expect(client.sleepCalls).toHaveLength(3);
    });

    it("applies exponential backoff on sequential 500s", async () => {
      const inner = makeInner([serverError(), serverError(), serverError(), ok()]);
      const client = new TestableRetryClient(inner, { jitter: false, baseDelayMs: 100, backoffMultiplier: 2 });

      await client.request(config);

      expect(client.sleepCalls).toEqual([100, 200, 400]); // 100*2^0, 100*2^1, 100*2^2
    });

    it("caps delay at maxDelayMs", async () => {
      const inner = makeInner([
        serverError(), serverError(), serverError(), serverError(), ok(),
      ]);
      const client = new TestableRetryClient(inner, {
        jitter: false,
        baseDelayMs: 1000,
        backoffMultiplier: 4,
        maxDelayMs: 5000,
        maxRetries: 4,
      });

      await client.request(config);

      // 1000*4^0=1000, 1000*4^1=4000, 1000*4^2=16000→5000, 1000*4^3=64000→5000
      expect(client.sleepCalls).toEqual([1000, 4000, 5000, 5000]);
    });

    it("retries on 502 and 503", async () => {
      const inner = makeInner([
        { status: 502, headers: {}, data: {} },
        { status: 503, headers: {}, data: {} },
        ok(),
      ]);
      const client = new TestableRetryClient(inner, { jitter: false });

      const res = await client.request(config);

      expect(res.status).toBe(200);
      expect(inner.callCount).toBe(3);
    });
  });

  describe("rate limit (429) retries", () => {
    it("retries on 429 and succeeds", async () => {
      const inner = makeInner([rateLimited(), ok()]);
      const client = new TestableRetryClient(inner, { jitter: false });

      const res = await client.request(config);

      expect(res.status).toBe(200);
      expect(inner.callCount).toBe(2);
    });

    it("respects Retry-After header on 429", async () => {
      const inner = makeInner([rateLimited("5"), ok()]);
      const client = new TestableRetryClient(inner, { jitter: false });

      await client.request(config);

      expect(client.sleepCalls).toEqual([5000]); // 5 seconds from header
    });

    it("caps Retry-After at maxDelayMs", async () => {
      const inner = makeInner([rateLimited("30"), ok()]);
      const client = new TestableRetryClient(inner, { jitter: false, maxDelayMs: 10000 });

      await client.request(config);

      expect(client.sleepCalls).toEqual([10000]);
    });

    it("falls back to exponential delay when Retry-After is missing", async () => {
      const inner = makeInner([rateLimited(), ok()]);
      const client = new TestableRetryClient(inner, { jitter: false, baseDelayMs: 200 });

      await client.request(config);

      expect(client.sleepCalls).toEqual([200]); // baseDelayMs * 2^0
    });
  });

  describe("network and timeout error retries", () => {
    it("retries on NetworkError and succeeds", async () => {
      const inner = makeInner([
        new NetworkError("ups", "Connection refused"),
        ok({ recovered: true }),
      ]);
      const client = new TestableRetryClient(inner, { jitter: false });

      const res = await client.request(config);

      expect(res.status).toBe(200);
      expect(inner.callCount).toBe(2);
    });

    it("retries on TimeoutError and succeeds", async () => {
      const inner = makeInner([
        new TimeoutError("ups", "Timed out"),
        ok(),
      ]);
      const client = new TestableRetryClient(inner, { jitter: false });

      const res = await client.request(config);

      expect(res.status).toBe(200);
      expect(inner.callCount).toBe(2);
    });

    it("throws NetworkError after exhausting retries", async () => {
      const networkErr = new NetworkError("ups", "DNS resolution failed");
      const inner = makeInner([networkErr, networkErr, networkErr, networkErr]);
      const client = new TestableRetryClient(inner, { maxRetries: 3 });

      await expect(client.request(config)).rejects.toThrow(NetworkError);
      expect(inner.callCount).toBe(4);
    });

    it("throws TimeoutError after exhausting retries", async () => {
      const timeoutErr = new TimeoutError("ups", "Timed out");
      const inner = makeInner([timeoutErr, timeoutErr]);
      const client = new TestableRetryClient(inner, { maxRetries: 1 });

      await expect(client.request(config)).rejects.toThrow(TimeoutError);
      expect(inner.callCount).toBe(2);
    });
  });

  describe("non-retryable errors", () => {
    it("does not retry 400 client errors", async () => {
      const inner = makeInner([badRequest()]);
      const client = new TestableRetryClient(inner);

      const res = await client.request(config);

      expect(res.status).toBe(400);
      expect(inner.callCount).toBe(1);
      expect(client.sleepCalls).toHaveLength(0);
    });

    it("does not retry 401 responses", async () => {
      const inner = makeInner([{ status: 401, headers: {}, data: {} }]);
      const client = new TestableRetryClient(inner);

      const res = await client.request(config);

      expect(res.status).toBe(401);
      expect(inner.callCount).toBe(1);
    });

    it("does not retry 403 responses", async () => {
      const inner = makeInner([{ status: 403, headers: {}, data: {} }]);
      const client = new TestableRetryClient(inner);

      const res = await client.request(config);

      expect(res.status).toBe(403);
      expect(inner.callCount).toBe(1);
    });

    it("does not retry ValidationError", async () => {
      const inner = makeInner([new ValidationError("ups", "Bad input", "invalid_field")]);
      const client = new TestableRetryClient(inner);

      await expect(client.request(config)).rejects.toThrow(ValidationError);
      expect(inner.callCount).toBe(1);
    });

    it("does not retry generic Error", async () => {
      const inner = makeInner([new Error("Something unexpected")]);
      const client = new TestableRetryClient(inner);

      await expect(client.request(config)).rejects.toThrow("Something unexpected");
      expect(inner.callCount).toBe(1);
    });
  });

  describe("configuration", () => {
    it("uses default config when none provided", () => {
      const inner = makeInner([]);
      const client = new RetryableHttpClient(inner);
      // Verify defaults exist (tested implicitly by retry behavior)
      expect(DEFAULT_RETRY_CONFIG.maxRetries).toBe(3);
      expect(DEFAULT_RETRY_CONFIG.baseDelayMs).toBe(500);
      expect(DEFAULT_RETRY_CONFIG.maxDelayMs).toBe(10_000);
      expect(DEFAULT_RETRY_CONFIG.backoffMultiplier).toBe(2);
      expect(DEFAULT_RETRY_CONFIG.jitter).toBe(true);
    });

    it("respects maxRetries: 0 (no retries)", async () => {
      const inner = makeInner([serverError()]);
      const client = new TestableRetryClient(inner, { maxRetries: 0 });

      const res = await client.request(config);

      expect(res.status).toBe(500);
      expect(inner.callCount).toBe(1);
      expect(client.sleepCalls).toHaveLength(0);
    });

    it("applies jitter when enabled", async () => {
      vi.spyOn(Math, "random").mockReturnValue(0.75); // deterministic

      const inner = makeInner([serverError(), ok()]);
      const client = new TestableRetryClient(inner, { jitter: true, baseDelayMs: 1000 });

      await client.request(config);

      // 1000 base, ±25% jitter with random=0.75
      // capped = 1000, jitterRange = 250
      // result = 1000 - 250 + (0.75 * 500) = 750 + 375 = 1125
      expect(client.sleepCalls[0]).toBe(1125);

      vi.restoreAllMocks();
    });
  });

  describe("mixed failure recovery", () => {
    it("recovers through a sequence of different transient failures", async () => {
      const inner = makeInner([
        new NetworkError("ups", "Connection reset"),
        serverError(),
        new TimeoutError("ups", "Timed out"),
        ok({ final: true }),
      ]);
      const client = new TestableRetryClient(inner, { maxRetries: 3, jitter: false, baseDelayMs: 100 });

      const res = await client.request(config);

      expect(res.status).toBe(200);
      expect(res.data).toEqual({ final: true });
      expect(inner.callCount).toBe(4);
      expect(client.sleepCalls).toEqual([100, 200, 400]);
    });
  });
});
