import { describe, it, expect } from "vitest";
import { RateShoppingService } from "../../src/carrier/rate-shopping-service.js";
import { AggregateCarrierError, CarrierError } from "../../src/domain/errors.js";
import { ServiceLevel } from "../../src/domain/models.js";
import type { CarrierProvider } from "../../src/carrier/carrier-provider.js";
import type { NormalizedRateQuote } from "../../src/domain/rate-response.js";
import type { DomainRateRequest } from "../../src/domain/rate-request.js";
import { sampleRateRequest } from "../helpers/fixtures.js";

function makeQuote(overrides: Partial<NormalizedRateQuote>): NormalizedRateQuote {
  return {
    carrier: "test",
    serviceCode: "01",
    serviceName: "Test Service",
    serviceLevel: ServiceLevel.Ground,
    totalCharges: { amount: "10.00", currency: "USD" },
    transitDays: 3,
    guaranteedDelivery: false,
    ratedPackages: [],
    warnings: [],
    ...overrides,
  };
}

function makeProvider(name: string, result: NormalizedRateQuote[] | Error): CarrierProvider {
  return {
    carrierName: name,
    rate: async () => {
      if (result instanceof Error) throw result;
      return result;
    },
  };
}

describe("RateShoppingService", () => {
  it("throws when constructed with zero providers", () => {
    expect(() => new RateShoppingService([])).toThrow(
      "RateShoppingService requires at least one carrier provider",
    );
  });

  it("returns sorted quotes from single carrier", async () => {
    const provider = makeProvider("ups", [
      makeQuote({ totalCharges: { amount: "30.00", currency: "USD" } }),
      makeQuote({ totalCharges: { amount: "10.00", currency: "USD" } }),
      makeQuote({ totalCharges: { amount: "20.00", currency: "USD" } }),
    ]);

    const service = new RateShoppingService([provider]);
    const quotes = await service.getRates(sampleRateRequest() as DomainRateRequest);

    expect(quotes).toHaveLength(3);
    expect(quotes[0].totalCharges.amount).toBe("10.00");
    expect(quotes[1].totalCharges.amount).toBe("20.00");
    expect(quotes[2].totalCharges.amount).toBe("30.00");
  });

  it("merges and sorts quotes from two carriers", async () => {
    const ups = makeProvider("ups", [
      makeQuote({ carrier: "ups", totalCharges: { amount: "25.00", currency: "USD" } }),
    ]);
    const fedex = makeProvider("fedex", [
      makeQuote({ carrier: "fedex", totalCharges: { amount: "15.00", currency: "USD" } }),
    ]);

    const service = new RateShoppingService([ups, fedex]);
    const quotes = await service.getRates(sampleRateRequest() as DomainRateRequest);

    expect(quotes).toHaveLength(2);
    expect(quotes[0].carrier).toBe("fedex");
    expect(quotes[1].carrier).toBe("ups");
  });

  it("returns partial results when one carrier fails", async () => {
    const ups = makeProvider("ups", [
      makeQuote({ carrier: "ups", totalCharges: { amount: "20.00", currency: "USD" } }),
    ]);
    const fedex = makeProvider(
      "fedex",
      new CarrierError("FedEx is down", "fedex", "server_error"),
    );

    const service = new RateShoppingService([ups, fedex]);
    const quotes = await service.getRates(sampleRateRequest() as DomainRateRequest);

    expect(quotes).toHaveLength(1);
    expect(quotes[0].carrier).toBe("ups");
  });

  it("throws AggregateCarrierError when all carriers fail", async () => {
    const ups = makeProvider("ups", new CarrierError("UPS down", "ups", "server_error"));
    const fedex = makeProvider("fedex", new CarrierError("FedEx down", "fedex", "server_error"));

    const service = new RateShoppingService([ups, fedex]);

    await expect(service.getRates(sampleRateRequest() as DomainRateRequest)).rejects.toThrow(
      AggregateCarrierError,
    );
  });

  it("validates input and throws on invalid address", async () => {
    const provider = makeProvider("ups", []);
    const service = new RateShoppingService([provider]);

    const invalidRequest = {
      origin: { addressLine1: "123 Main St", city: "", stateProvinceCode: "NY", postalCode: "10001", countryCode: "US" },
      destination: { addressLine1: "456 Oak Ave", city: "LA", stateProvinceCode: "CA", postalCode: "90001", countryCode: "US" },
      packages: [{ weight: { value: 5, unit: "LBS" as const } }],
    };

    await expect(service.getRates(invalidRequest as DomainRateRequest)).rejects.toThrow();
  });

  it("validates input and throws on empty packages array", async () => {
    const provider = makeProvider("ups", []);
    const service = new RateShoppingService([provider]);

    const invalidRequest = {
      ...sampleRateRequest(),
      packages: [],
    };

    await expect(service.getRates(invalidRequest as DomainRateRequest)).rejects.toThrow();
  });
});
