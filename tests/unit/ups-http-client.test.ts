import { describe, it, expect, beforeEach, vi } from "vitest";
import { UpsHttpClient } from "../../src/carriers/ups/ups-http-client.js";
import { UpsAuthManager } from "../../src/carriers/ups/ups-auth.js";
import { MockHttpClient, makeResponse } from "../helpers/mock-http-client.js";
import { fixtures } from "../helpers/fixtures.js";
import type { UpsConfig } from "../../src/carriers/ups/ups-config.js";

const testConfig: UpsConfig = {
  clientId: "test-id",
  clientSecret: "test-secret",
  baseUrl: "https://wwwcie.ups.com",
  apiVersion: "v2409",
  timeoutMs: 10000,
};

describe("UpsHttpClient", () => {
  let mockHttp: MockHttpClient;
  let authManager: UpsAuthManager;
  let upsHttpClient: UpsHttpClient;

  beforeEach(() => {
    mockHttp = new MockHttpClient();
    // Set up token endpoint
    mockHttp.onPost("/security/v1/oauth/token", makeResponse(200, fixtures.oauthToken()));
    authManager = new UpsAuthManager(mockHttp, testConfig);
    upsHttpClient = new UpsHttpClient(mockHttp, authManager);
  });

  it("injects Bearer token from auth manager", async () => {
    mockHttp.onPost("/api/test", makeResponse(200, { ok: true }));

    await upsHttpClient.request({ url: "https://wwwcie.ups.com/api/test", method: "POST" });

    const apiCall = mockHttp.calls.find((c) => c.url.includes("/api/test"));
    expect(apiCall?.headers?.Authorization).toMatch(/^Bearer /);
    expect(apiCall?.headers?.["Content-Type"]).toBe("application/json");
  });

  it("retries with fresh token on 401", async () => {
    mockHttp.onPostOnce("/api/test", makeResponse(401, {}));
    mockHttp.onPost("/api/test", makeResponse(200, { ok: true }));

    const response = await upsHttpClient.request({ url: "https://wwwcie.ups.com/api/test", method: "POST" });

    expect(response.status).toBe(200);
    // Two token fetches: initial + after invalidation
    const tokenCalls = mockHttp.calls.filter((c) => c.url.includes("/oauth/token"));
    expect(tokenCalls).toHaveLength(2);
  });

  it("preserves original config (including timeoutMs) on retry", async () => {
    mockHttp.onPostOnce("/api/test", makeResponse(401, {}));
    mockHttp.onPost("/api/test", makeResponse(200, { ok: true }));

    await upsHttpClient.request({
      url: "https://wwwcie.ups.com/api/test",
      method: "POST",
      timeoutMs: 5000,
    });

    const retryCalls = mockHttp.calls.filter((c) => c.url.includes("/api/test"));
    // Both calls should have timeoutMs preserved
    expect(retryCalls[0].timeoutMs).toBe(5000);
    expect(retryCalls[1].timeoutMs).toBe(5000);
  });

  it("passes through non-401 errors without retry", async () => {
    mockHttp.onPost("/api/test", makeResponse(500, { error: "server error" }));

    const response = await upsHttpClient.request({ url: "https://wwwcie.ups.com/api/test", method: "POST" });

    expect(response.status).toBe(500);
    // Only 1 token fetch, 1 API call (no retry)
    const tokenCalls = mockHttp.calls.filter((c) => c.url.includes("/oauth/token"));
    const apiCalls = mockHttp.calls.filter((c) => c.url.includes("/api/test"));
    expect(tokenCalls).toHaveLength(1);
    expect(apiCalls).toHaveLength(1);
  });

  it("allows caller to override Content-Type header", async () => {
    mockHttp.onPost("/api/test", makeResponse(200, { ok: true }));

    await upsHttpClient.request({
      url: "https://wwwcie.ups.com/api/test",
      method: "POST",
      headers: { "Content-Type": "application/xml" },
    });

    const apiCall = mockHttp.calls.find((c) => c.url.includes("/api/test"));
    expect(apiCall?.headers?.["Content-Type"]).toBe("application/xml");
  });

  it("returns 401 response when retry also fails with 401", async () => {
    // Both attempts return 401 — should not loop infinitely
    mockHttp.onPost("/api/test", makeResponse(401, { error: "still unauthorized" }));

    const response = await upsHttpClient.request({ url: "https://wwwcie.ups.com/api/test", method: "POST" });

    // The retry's 401 is returned to the caller (not retried again)
    expect(response.status).toBe(401);

    // Should have fetched token twice (initial + after invalidation) and made 2 API calls
    const tokenCalls = mockHttp.calls.filter((c) => c.url.includes("/oauth/token"));
    const apiCalls = mockHttp.calls.filter((c) => c.url.includes("/api/test"));
    expect(tokenCalls).toHaveLength(2);
    expect(apiCalls).toHaveLength(2);
  });
});
