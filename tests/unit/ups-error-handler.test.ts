import { describe, it, expect } from "vitest";
import { UpsErrorHandler } from "../../src/carriers/ups/ups-error-handler.js";
import {
  AuthenticationError,
  CarrierError,
  RateLimitError,
  ValidationError,
} from "../../src/domain/errors.js";
import { makeResponse } from "../helpers/mock-http-client.js";
import { fixtures } from "../helpers/fixtures.js";

describe("UpsErrorHandler", () => {
  const handler = new UpsErrorHandler();

  it("passes through on 200 success", () => {
    expect(() => handler.assertSuccess(makeResponse(200, {}))).not.toThrow();
  });

  it("passes through on 201", () => {
    expect(() => handler.assertSuccess(makeResponse(201, {}))).not.toThrow();
  });

  it("throws ValidationError on 400 with structured UPS errors", () => {
    const response = makeResponse(400, fixtures.rateErrorInvalidAddress());

    expect(() => handler.assertSuccess(response)).toThrow(ValidationError);
    try {
      handler.assertSuccess(response);
    } catch (err) {
      const e = err as ValidationError;
      expect(e.code).toBe("111210");
      expect(e.message).toContain("postal code");
    }
  });

  it("throws AuthenticationError on 401 with httpStatus 401", () => {
    const response = makeResponse(401, fixtures.rateErrorAuthFailure());

    expect(() => handler.assertSuccess(response)).toThrow(AuthenticationError);
    try {
      handler.assertSuccess(response);
    } catch (err) {
      const e = err as AuthenticationError;
      expect(e.httpStatus).toBe(401);
      expect(e.carrier).toBe("ups");
    }
  });

  it("throws AuthenticationError on 403 with httpStatus 403", () => {
    const response = makeResponse(403, { response: { errors: [] } });

    expect(() => handler.assertSuccess(response)).toThrow(AuthenticationError);
    try {
      handler.assertSuccess(response);
    } catch (err) {
      const e = err as AuthenticationError;
      expect(e.httpStatus).toBe(403);
      expect(e.message).toContain("Forbidden");
    }
  });

  it("throws RateLimitError on 429 with Retry-After header", () => {
    const response = makeResponse(429, fixtures.rateErrorRateLimit(), {
      "retry-after": "30",
    });

    expect(() => handler.assertSuccess(response)).toThrow(RateLimitError);
    try {
      handler.assertSuccess(response);
    } catch (err) {
      const e = err as RateLimitError;
      expect(e.retryAfterMs).toBe(30_000);
    }
  });

  it("throws RateLimitError on 429 without Retry-After header", () => {
    const response = makeResponse(429, fixtures.rateErrorRateLimit());

    expect(() => handler.assertSuccess(response)).toThrow(RateLimitError);
    try {
      handler.assertSuccess(response);
    } catch (err) {
      expect((err as RateLimitError).retryAfterMs).toBeUndefined();
    }
  });

  it("throws CarrierError on 500 server error", () => {
    const response = makeResponse(500, { response: { errors: [{ code: "999", message: "Internal error" }] } });

    expect(() => handler.assertSuccess(response)).toThrow(CarrierError);
    try {
      handler.assertSuccess(response);
    } catch (err) {
      expect((err as CarrierError).code).toBe("server_error");
      expect((err as CarrierError).httpStatus).toBe(500);
    }
  });

  it("handles 400 with non-standard error body", () => {
    const response = makeResponse(400, { some: "unexpected body" });

    expect(() => handler.assertSuccess(response)).toThrow(ValidationError);
  });

  it("throws CarrierError on 502 Bad Gateway", () => {
    const response = makeResponse(502, "Bad Gateway");

    expect(() => handler.assertSuccess(response)).toThrow(CarrierError);
    try {
      handler.assertSuccess(response);
    } catch (err) {
      expect((err as CarrierError).code).toBe("server_error");
      expect((err as CarrierError).httpStatus).toBe(502);
    }
  });

  it("throws CarrierError on 503 Service Unavailable", () => {
    const response = makeResponse(503, null);

    expect(() => handler.assertSuccess(response)).toThrow(CarrierError);
  });

  it("handles non-numeric Retry-After header gracefully", () => {
    const response = makeResponse(429, fixtures.rateErrorRateLimit(), {
      "retry-after": "not-a-number",
    });

    expect(() => handler.assertSuccess(response)).toThrow(RateLimitError);
    try {
      handler.assertSuccess(response);
    } catch (err) {
      expect((err as RateLimitError).retryAfterMs).toBeUndefined();
    }
  });

  it("extracts message from UPS error response on 500", () => {
    const response = makeResponse(500, {
      response: { errors: [{ code: "SYS001", message: "System temporarily unavailable" }] },
    });

    try {
      handler.assertSuccess(response);
    } catch (err) {
      expect((err as CarrierError).message).toContain("System temporarily unavailable");
    }
  });

  it("handles null response data on 400", () => {
    const response = makeResponse(400, null);

    expect(() => handler.assertSuccess(response)).toThrow(ValidationError);
  });
});
