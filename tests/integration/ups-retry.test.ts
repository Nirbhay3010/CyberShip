import { describe, it, expect, beforeEach } from "vitest";
import { UpsProvider } from "../../src/carriers/ups/ups-provider.js";
import type { UpsConfig } from "../../src/carriers/ups/ups-config.js";
import { CarrierError, NetworkError } from "../../src/domain/errors.js";
import type { DomainRateRequest } from "../../src/domain/rate-request.js";
import type { HttpClient, HttpRequestConfig, HttpResponse } from "../../src/http/http-client.js";
import { fixtures, sampleRateRequest } from "../helpers/fixtures.js";
import { makeResponse } from "../helpers/mock-http-client.js";

const testConfig: UpsConfig = {
  clientId: "test-client-id",
  clientSecret: "test-client-secret",
  accountNumber: "TEST123",
  baseUrl: "https://wwwcie.ups.com",
  apiVersion: "v2409",
  timeoutMs: 10000,
};

/**
 * A mock that supports sequenced responses per URL pattern, with sleep override.
 * Tracks call counts so we can verify retry behavior end-to-end.
 */
class SequencedMockHttpClient implements HttpClient {
  private sequences = new Map<string, HttpResponse[]>();
  private callCounts = new Map<string, number>();

  /** Queue ordered responses for a URL pattern */
  forUrl(pattern: string, ...responses: HttpResponse[]): this {
    this.sequences.set(pattern, responses);
    this.callCounts.set(pattern, 0);
    return this;
  }

  getCallCount(pattern: string): number {
    return this.callCounts.get(pattern) ?? 0;
  }

  async request<T>(_config: HttpRequestConfig): Promise<HttpResponse<T>> {
    for (const [pattern, responses] of this.sequences) {
      if (_config.url.includes(pattern)) {
        const count = this.callCounts.get(pattern) ?? 0;
        this.callCounts.set(pattern, count + 1);
        const response = responses[Math.min(count, responses.length - 1)];
        return response as HttpResponse<T>;
      }
    }
    throw new Error(`No mock for ${_config.url}`);
  }
}

describe("UPS Retry Integration", () => {
  let mockHttp: SequencedMockHttpClient;

  beforeEach(() => {
    mockHttp = new SequencedMockHttpClient();
  });

  it("retries 500 from rating endpoint and succeeds on recovery", async () => {
    mockHttp
      .forUrl("/oauth/token", makeResponse(200, fixtures.oauthToken()))
      .forUrl(
        "/api/rating/",
        makeResponse(500, { response: { errors: [{ code: "SYS", message: "Down" }] } }),
        makeResponse(500, { response: { errors: [{ code: "SYS", message: "Down" }] } }),
        makeResponse(200, fixtures.rateShopResponse()),
      );

    const provider = new UpsProvider(mockHttp, testConfig, {
      maxRetries: 3,
      baseDelayMs: 1, // fast for test
      jitter: false,
    });

    const request = sampleRateRequest() as DomainRateRequest;
    const quotes = await provider.rate(request);

    expect(quotes).toHaveLength(3);
    expect(quotes.every((q) => q.carrier === "ups")).toBe(true);
    // 3 rating attempts: 2 failed + 1 success
    expect(mockHttp.getCallCount("/api/rating/")).toBe(3);
  });

  it("retries 500 from OAuth endpoint and succeeds on recovery", async () => {
    mockHttp
      .forUrl(
        "/oauth/token",
        makeResponse(500, {}),
        makeResponse(500, {}),
        makeResponse(200, fixtures.oauthToken()),
      )
      .forUrl("/api/rating/", makeResponse(200, fixtures.rateShopResponse()));

    const provider = new UpsProvider(mockHttp, testConfig, {
      maxRetries: 3,
      baseDelayMs: 1,
      jitter: false,
    });

    const request = sampleRateRequest() as DomainRateRequest;
    const quotes = await provider.rate(request);

    expect(quotes).toHaveLength(3);
  });

  it("surfaces 500 as CarrierError after all retries exhausted", async () => {
    mockHttp
      .forUrl("/oauth/token", makeResponse(200, fixtures.oauthToken()))
      .forUrl(
        "/api/rating/",
        makeResponse(500, { response: { errors: [{ code: "SYS", message: "Unavailable" }] } }),
      );

    const provider = new UpsProvider(mockHttp, testConfig, {
      maxRetries: 2,
      baseDelayMs: 1,
      jitter: false,
    });

    const request = sampleRateRequest() as DomainRateRequest;
    const err = await provider.rate(request).catch((e) => e);

    expect(err).toBeInstanceOf(CarrierError);
    expect((err as CarrierError).code).toBe("server_error");
    // 1 initial + 2 retries = 3
    expect(mockHttp.getCallCount("/api/rating/")).toBe(3);
  });

  it("does not retry 400 validation errors from rating endpoint", async () => {
    mockHttp
      .forUrl("/oauth/token", makeResponse(200, fixtures.oauthToken()))
      .forUrl("/api/rating/", makeResponse(400, fixtures.rateErrorInvalidAddress()));

    const provider = new UpsProvider(mockHttp, testConfig, {
      maxRetries: 3,
      baseDelayMs: 1,
      jitter: false,
    });

    const request = sampleRateRequest() as DomainRateRequest;
    const err = await provider.rate(request).catch((e) => e);

    expect(err).toBeInstanceOf(CarrierError);
    // Only 1 call — not retried
    expect(mockHttp.getCallCount("/api/rating/")).toBe(1);
  });

  it("retries 429 from rating endpoint respecting Retry-After", async () => {
    mockHttp
      .forUrl("/oauth/token", makeResponse(200, fixtures.oauthToken()))
      .forUrl(
        "/api/rating/",
        { status: 429, headers: { "retry-after": "1" }, data: {} },
        makeResponse(200, fixtures.rateShopResponse()),
      );

    const provider = new UpsProvider(mockHttp, testConfig, {
      maxRetries: 2,
      baseDelayMs: 1,
      jitter: false,
    });

    const request = sampleRateRequest() as DomainRateRequest;
    const quotes = await provider.rate(request);

    expect(quotes).toHaveLength(3);
    expect(mockHttp.getCallCount("/api/rating/")).toBe(2);
  });
});
