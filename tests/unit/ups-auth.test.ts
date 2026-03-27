import { describe, it, expect, vi, beforeEach } from "vitest";
import { UpsAuthManager } from "../../src/carriers/ups/ups-auth.js";
import { AuthenticationError, CarrierError } from "../../src/domain/errors.js";
import { MockHttpClient, makeResponse } from "../helpers/mock-http-client.js";
import { fixtures } from "../helpers/fixtures.js";
import type { UpsConfig } from "../../src/carriers/ups/ups-config.js";

const testConfig: UpsConfig = {
  clientId: "test-client-id",
  clientSecret: "test-client-secret",
  baseUrl: "https://wwwcie.ups.com",
  apiVersion: "v2409",
  timeoutMs: 10000,
};

describe("UpsAuthManager", () => {
  let mockHttp: MockHttpClient;
  let authManager: UpsAuthManager;

  beforeEach(() => {
    mockHttp = new MockHttpClient();
    authManager = new UpsAuthManager(mockHttp, testConfig);
    vi.restoreAllMocks();
  });

  it("fetches a new token when cache is empty", async () => {
    mockHttp.onPost("/security/v1/oauth/token", makeResponse(200, fixtures.oauthToken()));

    const token = await authManager.getAccessToken();

    expect(token).toBe(
      "eyJhbGciOiJSUzM4NCIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ0ZXN0X2NsaWVudCIsImlhdCI6MTcwNjgwMzIwMH0.test-signature",
    );
    expect(mockHttp.calls).toHaveLength(1);
    expect(mockHttp.calls[0].headers?.Authorization).toMatch(/^Basic /);
  });

  it("sends correct Basic auth header with base64 encoded credentials", async () => {
    mockHttp.onPost("/security/v1/oauth/token", makeResponse(200, fixtures.oauthToken()));

    await authManager.getAccessToken();

    const expectedCredentials = Buffer.from("test-client-id:test-client-secret").toString("base64");
    expect(mockHttp.calls[0].headers?.Authorization).toBe(`Basic ${expectedCredentials}`);
  });

  it("sends form-encoded body", async () => {
    mockHttp.onPost("/security/v1/oauth/token", makeResponse(200, fixtures.oauthToken()));

    await authManager.getAccessToken();

    expect(mockHttp.calls[0].formEncoded).toBe(true);
    expect(mockHttp.calls[0].body).toEqual({ grant_type: "client_credentials" });
  });

  it("returns cached token when not expired", async () => {
    mockHttp.onPost("/security/v1/oauth/token", makeResponse(200, fixtures.oauthToken()));

    const token1 = await authManager.getAccessToken();
    const token2 = await authManager.getAccessToken();

    expect(token1).toBe(token2);
    expect(mockHttp.calls).toHaveLength(1); // Only one HTTP call
  });

  it("re-fetches when token has expired", async () => {
    vi.useFakeTimers();
    mockHttp.onPost("/security/v1/oauth/token", makeResponse(200, fixtures.oauthToken()));

    await authManager.getAccessToken();
    expect(mockHttp.calls).toHaveLength(1);

    // Advance past expiry (14399s - 60s margin = 14339s)
    vi.advanceTimersByTime(14340 * 1000);

    await authManager.getAccessToken();
    expect(mockHttp.calls).toHaveLength(2);

    vi.useRealTimers();
  });

  it("invalidateToken() forces next call to re-fetch", async () => {
    mockHttp.onPost("/security/v1/oauth/token", makeResponse(200, fixtures.oauthToken()));

    await authManager.getAccessToken();
    expect(mockHttp.calls).toHaveLength(1);

    authManager.invalidateToken();
    await authManager.getAccessToken();
    expect(mockHttp.calls).toHaveLength(2);
  });

  it("throws AuthenticationError on 401 from OAuth endpoint", async () => {
    mockHttp.onPost(
      "/security/v1/oauth/token",
      makeResponse(401, { error: "invalid_client", error_description: "Bad credentials" }),
    );

    await expect(authManager.getAccessToken()).rejects.toThrow(AuthenticationError);
  });

  it("throws CarrierError on malformed token response", async () => {
    mockHttp.onPost(
      "/security/v1/oauth/token",
      makeResponse(200, { unexpected: "shape" }),
    );

    await expect(authManager.getAccessToken()).rejects.toThrow(CarrierError);
  });

  it("deduplicates concurrent token fetches", async () => {
    mockHttp.onPost("/security/v1/oauth/token", makeResponse(200, fixtures.oauthToken()));

    // Fire three concurrent requests — should only produce one HTTP call
    const [token1, token2, token3] = await Promise.all([
      authManager.getAccessToken(),
      authManager.getAccessToken(),
      authManager.getAccessToken(),
    ]);

    expect(token1).toBe(token2);
    expect(token2).toBe(token3);
    expect(mockHttp.calls).toHaveLength(1);
  });

  it("includes response data as error cause on auth failure", async () => {
    const errorData = { error: "invalid_client", error_description: "Bad creds" };
    mockHttp.onPost("/security/v1/oauth/token", makeResponse(401, errorData));

    try {
      await authManager.getAccessToken();
    } catch (err) {
      expect((err as AuthenticationError).cause).toEqual(errorData);
    }
  });
});
