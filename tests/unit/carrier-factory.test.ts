import { describe, it, expect, beforeEach } from "vitest";
import { CarrierFactory } from "../../src/carrier/carrier-factory.js";
import type { CarrierProvider } from "../../src/carrier/carrier-provider.js";
import type { HttpClient } from "../../src/http/http-client.js";
import { MockHttpClient } from "../helpers/mock-http-client.js";

// Minimal mock provider for factory tests
const mockRegistration = {
  create(_httpClient: HttpClient, _env: Record<string, string | undefined>): CarrierProvider {
    return {
      carrierName: "test-carrier",
      rate: async () => [],
    };
  },
};

describe("CarrierFactory", () => {
  beforeEach(() => {
    // Note: UPS is auto-registered on import. We test with a custom carrier.
  });

  it("creates a registered carrier by name", () => {
    CarrierFactory.register("test", mockRegistration);
    const provider = CarrierFactory.create("test", new MockHttpClient(), {});

    expect(provider.carrierName).toBe("test-carrier");
  });

  it("throws on unknown carrier name", () => {
    expect(() => CarrierFactory.create("nonexistent", new MockHttpClient(), {})).toThrow(
      /Unknown carrier: "nonexistent"/,
    );
  });

  it("lists registered carriers", () => {
    CarrierFactory.register("test2", mockRegistration);
    const carriers = CarrierFactory.registeredCarriers();

    expect(carriers).toContain("test2");
  });

  it("createAll returns all registered carriers", () => {
    CarrierFactory.register("test3", mockRegistration);
    const providers = CarrierFactory.createAll(new MockHttpClient(), {});

    expect(providers.length).toBeGreaterThan(0);
  });

  it("has UPS auto-registered from import", async () => {
    // Import triggers UPS self-registration
    await import("../../src/carriers/ups/index.js");
    expect(CarrierFactory.registeredCarriers()).toContain("ups");
  });
});
