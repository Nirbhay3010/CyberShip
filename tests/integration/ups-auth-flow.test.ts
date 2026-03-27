import { describe, it, expect, beforeEach, vi } from "vitest";
import { UpsProvider } from "../../src/carriers/ups/ups-provider.js";
import type { UpsConfig } from "../../src/carriers/ups/ups-config.js";
import type { DomainRateRequest } from "../../src/domain/rate-request.js";
import { MockHttpClient, makeResponse } from "../helpers/mock-http-client.js";
import { fixtures, sampleRateRequest } from "../helpers/fixtures.js";

const testConfig: UpsConfig = {
  clientId: "test-client-id",
  clientSecret: "test-client-secret",
  baseUrl: "https://wwwcie.ups.com",
  apiVersion: "v2409",
  timeoutMs: 10000,
};

describe("UPS Auth Flow Integration", () => {
  let mockHttp: MockHttpClient;
  let provider: UpsProvider;

  beforeEach(() => {
    mockHttp = new MockHttpClient();
    provider = new UpsProvider(mockHttp, testConfig, { maxRetries: 0 });
    vi.restoreAllMocks();
  });

  it("performs full OAuth flow with correct Basic auth header", async () => {
    mockHttp.onPost("/security/v1/oauth/token", makeResponse(200, fixtures.oauthToken()));
    mockHttp.onPost("/api/rating/", makeResponse(200, fixtures.rateShopResponse()));

    const request = sampleRateRequest() as DomainRateRequest;
    await provider.rate(request);

    const tokenCall = mockHttp.calls.find((c) => c.url.includes("/oauth/token"));
    expect(tokenCall).toBeDefined();

    const expectedBasic = Buffer.from("test-client-id:test-client-secret").toString("base64");
    expect(tokenCall!.headers?.Authorization).toBe(`Basic ${expectedBasic}`);
    expect(tokenCall!.formEncoded).toBe(true);
    expect(tokenCall!.body).toEqual({ grant_type: "client_credentials" });
  });

  it("reuses cached token across sequential requests", async () => {
    mockHttp.onPost("/security/v1/oauth/token", makeResponse(200, fixtures.oauthToken()));
    mockHttp.onPost("/api/rating/", makeResponse(200, fixtures.rateShopResponse()));

    const request = sampleRateRequest() as DomainRateRequest;

    // Two sequential rate calls
    await provider.rate(request);
    await provider.rate(request);

    // Should only have 1 OAuth call despite 2 rating calls
    const tokenCalls = mockHttp.calls.filter((c) => c.url.includes("/oauth/token"));
    const ratingCalls = mockHttp.calls.filter((c) => c.url.includes("/api/rating/"));
    expect(tokenCalls).toHaveLength(1);
    expect(ratingCalls).toHaveLength(2);
  });

  it("fetches new token when cached token has expired", async () => {
    vi.useFakeTimers();

    mockHttp.onPost("/security/v1/oauth/token", makeResponse(200, fixtures.oauthToken()));
    mockHttp.onPost("/api/rating/", makeResponse(200, fixtures.rateShopResponse()));

    const request = sampleRateRequest() as DomainRateRequest;

    // First call fetches token
    await provider.rate(request);
    const tokenCallsBefore = mockHttp.calls.filter((c) => c.url.includes("/oauth/token"));
    expect(tokenCallsBefore).toHaveLength(1);

    // Advance past token expiry (14399s expires_in minus 60s margin)
    vi.advanceTimersByTime(14340 * 1000);

    // Second call should fetch new token
    await provider.rate(request);
    const tokenCallsAfter = mockHttp.calls.filter((c) => c.url.includes("/oauth/token"));
    expect(tokenCallsAfter).toHaveLength(2);

    vi.useRealTimers();
  });

  it("refreshes token and retries on 401 from rating endpoint", async () => {
    mockHttp.onPost("/security/v1/oauth/token", makeResponse(200, fixtures.oauthToken()));

    // First rating call returns 401
    mockHttp.onPostOnce("/api/rating/", makeResponse(401, fixtures.rateErrorAuthFailure()));
    // Retry succeeds
    mockHttp.onPost("/api/rating/", makeResponse(200, fixtures.rateShopResponse()));

    const request = sampleRateRequest() as DomainRateRequest;
    const quotes = await provider.rate(request);

    // Should succeed with the retry
    expect(quotes).toHaveLength(3);

    // Verify token was fetched twice (initial + after invalidation)
    const tokenCalls = mockHttp.calls.filter((c) => c.url.includes("/oauth/token"));
    expect(tokenCalls).toHaveLength(2);
  });

  it("uses Bearer token from OAuth response in rating requests", async () => {
    const tokenData = fixtures.oauthToken() as Record<string, unknown>;
    mockHttp.onPost("/security/v1/oauth/token", makeResponse(200, tokenData));
    mockHttp.onPost("/api/rating/", makeResponse(200, fixtures.rateShopResponse()));

    const request = sampleRateRequest() as DomainRateRequest;
    await provider.rate(request);

    const ratingCall = mockHttp.calls.find((c) => c.url.includes("/api/rating/"));
    expect(ratingCall!.headers?.Authorization).toBe(`Bearer ${tokenData.access_token}`);
  });
});
