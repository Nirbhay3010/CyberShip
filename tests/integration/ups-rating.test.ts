import { describe, it, expect, beforeEach } from "vitest";
import { UpsProvider } from "../../src/carriers/ups/ups-provider.js";
import type { UpsConfig } from "../../src/carriers/ups/ups-config.js";
import { ServiceLevel } from "../../src/domain/models.js";
import {
  AuthenticationError,
  CarrierError,
  RateLimitError,
  ValidationError,
} from "../../src/domain/errors.js";
import type { DomainRateRequest } from "../../src/domain/rate-request.js";
import { MockHttpClient, makeResponse } from "../helpers/mock-http-client.js";
import { fixtures, sampleRateRequest } from "../helpers/fixtures.js";

const testConfig: UpsConfig = {
  clientId: "test-client-id",
  clientSecret: "test-client-secret",
  accountNumber: "TEST123",
  baseUrl: "https://wwwcie.ups.com",
  apiVersion: "v2409",
  timeoutMs: 10000,
};

describe("UPS Rating Integration", () => {
  let mockHttp: MockHttpClient;
  let provider: UpsProvider;

  beforeEach(() => {
    mockHttp = new MockHttpClient();
    // Disable retries so these tests exercise the rating logic without delay
    provider = new UpsProvider(mockHttp, testConfig, { maxRetries: 0 });
  });

  it("full rate-shop flow: returns normalized quotes sorted by amount", async () => {
    // Stub OAuth token
    mockHttp.onPost("/security/v1/oauth/token", makeResponse(200, fixtures.oauthToken()));
    // Stub rating endpoint
    mockHttp.onPost("/api/rating/", makeResponse(200, fixtures.rateShopResponse()));

    const request = sampleRateRequest() as DomainRateRequest;
    const quotes = await provider.rate(request);

    expect(quotes).toHaveLength(3);
    // Verify all quotes have carrier "ups"
    expect(quotes.every((q) => q.carrier === "ups")).toBe(true);

    // Verify mapping
    const ground = quotes.find((q) => q.serviceCode === "03");
    expect(ground).toBeDefined();
    expect(ground!.serviceName).toBe("UPS Ground");
    expect(ground!.serviceLevel).toBe(ServiceLevel.Ground);
    expect(ground!.totalCharges).toEqual({ amount: "18.50", currency: "USD" });
    expect(ground!.transitDays).toBe(5);

    const nextDay = quotes.find((q) => q.serviceCode === "01");
    expect(nextDay).toBeDefined();
    expect(nextDay!.totalCharges.amount).toBe("58.99");
    expect(nextDay!.transitDays).toBe(1);
  });

  it("builds correct UPS request payload from domain request", async () => {
    mockHttp.onPost("/security/v1/oauth/token", makeResponse(200, fixtures.oauthToken()));
    mockHttp.onPost("/api/rating/", makeResponse(200, fixtures.rateShopResponse()));

    const request = sampleRateRequest() as DomainRateRequest;
    await provider.rate(request);

    // The second call should be the rating request
    const ratingCall = mockHttp.calls.find((c) => c.url.includes("/api/rating/"));
    expect(ratingCall).toBeDefined();
    expect(ratingCall!.url).toContain("/api/rating/v2409/Shop");

    const body = ratingCall!.body as any;
    expect(body.RateRequest.Shipment.Shipper.Address.PostalCode).toBe("10001");
    expect(body.RateRequest.Shipment.ShipTo.Address.PostalCode).toBe("90001");
    expect(body.RateRequest.Shipment.Package).toHaveLength(1);
    expect(body.RateRequest.Shipment.Package[0].PackageWeight.Weight).toBe("5.5");
    expect(body.RateRequest.Shipment.Service).toBeUndefined(); // Shop mode
  });

  it("uses Rate endpoint with service code when service level specified", async () => {
    mockHttp.onPost("/security/v1/oauth/token", makeResponse(200, fixtures.oauthToken()));
    mockHttp.onPost("/api/rating/", makeResponse(200, fixtures.rateSingleServiceResponse()));

    const request = {
      ...sampleRateRequest(),
      serviceLevel: ServiceLevel.Ground,
    } as DomainRateRequest;

    const quotes = await provider.rate(request);

    const ratingCall = mockHttp.calls.find((c) => c.url.includes("/api/rating/"));
    expect(ratingCall!.url).toContain("/api/rating/v2409/Rate");

    const body = ratingCall!.body as any;
    expect(body.RateRequest.Shipment.Service).toEqual({ Code: "03" });

    expect(quotes).toHaveLength(1);
    expect(quotes[0].serviceCode).toBe("03");
  });

  it("handles single RatedShipment (object) response", async () => {
    mockHttp.onPost("/security/v1/oauth/token", makeResponse(200, fixtures.oauthToken()));
    mockHttp.onPost("/api/rating/", makeResponse(200, fixtures.rateSingleServiceResponse()));

    const request = {
      ...sampleRateRequest(),
      serviceLevel: ServiceLevel.Ground,
    } as DomainRateRequest;

    const quotes = await provider.rate(request);

    expect(quotes).toHaveLength(1);
    expect(quotes[0].totalCharges.amount).toBe("18.50");
  });

  it("throws ValidationError on 400 invalid address response", async () => {
    mockHttp.onPost("/security/v1/oauth/token", makeResponse(200, fixtures.oauthToken()));
    mockHttp.onPost("/api/rating/", makeResponse(400, fixtures.rateErrorInvalidAddress()));

    const request = sampleRateRequest() as DomainRateRequest;

    const err = await provider.rate(request).catch((e) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as ValidationError).code).toBe("111210");
    expect((err as ValidationError).message).toContain("postal code");
  });

  it("throws RateLimitError on 429 response", async () => {
    mockHttp.onPost("/security/v1/oauth/token", makeResponse(200, fixtures.oauthToken()));
    mockHttp.onPost(
      "/api/rating/",
      makeResponse(429, fixtures.rateErrorRateLimit(), { "retry-after": "60" }),
    );

    const request = sampleRateRequest() as DomainRateRequest;

    const err = await provider.rate(request).catch((e) => e);
    expect(err).toBeInstanceOf(RateLimitError);
    expect((err as RateLimitError).retryAfterMs).toBe(60_000);
  });

  it("retries with fresh token on 401 from rating endpoint", async () => {
    // First token fetch succeeds
    mockHttp.onPost("/security/v1/oauth/token", makeResponse(200, fixtures.oauthToken()));

    // First rating call returns 401, then second succeeds
    mockHttp.onPostOnce("/api/rating/", makeResponse(401, fixtures.rateErrorAuthFailure()));
    mockHttp.onPost("/api/rating/", makeResponse(200, fixtures.rateShopResponse()));

    const request = sampleRateRequest() as DomainRateRequest;
    const quotes = await provider.rate(request);

    expect(quotes).toHaveLength(3);

    // Should have made 2 token calls (initial + refresh after 401) and 2 rating calls
    const tokenCalls = mockHttp.calls.filter((c) => c.url.includes("/oauth/token"));
    const ratingCalls = mockHttp.calls.filter((c) => c.url.includes("/api/rating/"));
    expect(tokenCalls).toHaveLength(2);
    expect(ratingCalls).toHaveLength(2);
  });

  it("includes account number in shipper when configured", async () => {
    mockHttp.onPost("/security/v1/oauth/token", makeResponse(200, fixtures.oauthToken()));
    mockHttp.onPost("/api/rating/", makeResponse(200, fixtures.rateShopResponse()));

    const request = sampleRateRequest() as DomainRateRequest;
    await provider.rate(request);

    const ratingCall = mockHttp.calls.find((c) => c.url.includes("/api/rating/"));
    const body = ratingCall!.body as any;
    expect(body.RateRequest.Shipment.Shipper.ShipperNumber).toBe("TEST123");
  });

  it("injects Bearer token in Authorization header", async () => {
    mockHttp.onPost("/security/v1/oauth/token", makeResponse(200, fixtures.oauthToken()));
    mockHttp.onPost("/api/rating/", makeResponse(200, fixtures.rateShopResponse()));

    const request = sampleRateRequest() as DomainRateRequest;
    await provider.rate(request);

    const ratingCall = mockHttp.calls.find((c) => c.url.includes("/api/rating/"));
    expect(ratingCall!.headers?.Authorization).toMatch(/^Bearer /);
  });

  it("throws CarrierError on 500 server error from rating endpoint", async () => {
    mockHttp.onPost("/security/v1/oauth/token", makeResponse(200, fixtures.oauthToken()));
    mockHttp.onPost("/api/rating/", makeResponse(500, {
      response: { errors: [{ code: "SYS001", message: "System temporarily unavailable" }] },
    }));

    const request = sampleRateRequest() as DomainRateRequest;

    const err = await provider.rate(request).catch((e) => e);
    expect(err).toBeInstanceOf(CarrierError);
    expect((err as CarrierError).code).toBe("server_error");
    expect((err as CarrierError).httpStatus).toBe(500);
  });

  it("throws CarrierError with malformed_response on invalid JSON structure", async () => {
    mockHttp.onPost("/security/v1/oauth/token", makeResponse(200, fixtures.oauthToken()));
    mockHttp.onPost("/api/rating/", makeResponse(200, { unexpected: "shape" }));

    const request = sampleRateRequest() as DomainRateRequest;

    const err = await provider.rate(request).catch((e) => e);
    expect(err).toBeInstanceOf(CarrierError);
    expect((err as CarrierError).code).toBe("malformed_response");
  });

  it("correctly maps addressLine2 into UPS AddressLine array", async () => {
    mockHttp.onPost("/security/v1/oauth/token", makeResponse(200, fixtures.oauthToken()));
    mockHttp.onPost("/api/rating/", makeResponse(200, fixtures.rateShopResponse()));

    const request = {
      ...sampleRateRequest(),
      origin: {
        ...sampleRateRequest().origin,
        addressLine2: "Suite 100",
      },
    } as DomainRateRequest;

    await provider.rate(request);

    const ratingCall = mockHttp.calls.find((c) => c.url.includes("/api/rating/"));
    const body = ratingCall!.body as any;
    expect(body.RateRequest.Shipment.Shipper.Address.AddressLine).toEqual([
      "123 Main St",
      "Suite 100",
    ]);
  });

  it("uses default name when origin/destination name is not provided", async () => {
    mockHttp.onPost("/security/v1/oauth/token", makeResponse(200, fixtures.oauthToken()));
    mockHttp.onPost("/api/rating/", makeResponse(200, fixtures.rateShopResponse()));

    const request = sampleRateRequest() as DomainRateRequest;
    delete (request.origin as any).name;
    delete (request.destination as any).name;

    await provider.rate(request);

    const ratingCall = mockHttp.calls.find((c) => c.url.includes("/api/rating/"));
    const body = ratingCall!.body as any;
    expect(body.RateRequest.Shipment.Shipper.Name).toBe("Shipper");
    expect(body.RateRequest.Shipment.ShipTo.Name).toBe("Recipient");
  });
});
