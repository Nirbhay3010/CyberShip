import { describe, it, expect } from "vitest";
import { UpsRateMapper } from "../../src/carriers/ups/ups-rate-mapper.js";
import { ServiceLevel } from "../../src/domain/models.js";
import { CarrierError } from "../../src/domain/errors.js";
import { fixtures, sampleRateRequest } from "../helpers/fixtures.js";
import type { DomainRateRequest } from "../../src/domain/rate-request.js";

describe("UpsRateMapper", () => {
  describe("resolveRequestOption", () => {
    it('returns "Shop" when no service level is specified', () => {
      const request = sampleRateRequest() as DomainRateRequest;
      expect(UpsRateMapper.resolveRequestOption(request)).toBe("Shop");
    });

    it('returns "Rate" when a service level is specified', () => {
      const request = { ...sampleRateRequest(), serviceLevel: ServiceLevel.Ground } as DomainRateRequest;
      expect(UpsRateMapper.resolveRequestOption(request)).toBe("Rate");
    });
  });

  describe("toUpsRequest", () => {
    it("maps a minimal domain request to UPS format", () => {
      const request = sampleRateRequest() as DomainRateRequest;
      const upsBody = UpsRateMapper.toUpsRequest(request);

      expect(upsBody.RateRequest.Shipment.Shipper.Name).toBe("Test Shipper");
      expect(upsBody.RateRequest.Shipment.Shipper.Address.City).toBe("New York");
      expect(upsBody.RateRequest.Shipment.Shipper.Address.PostalCode).toBe("10001");
      expect(upsBody.RateRequest.Shipment.Shipper.Address.CountryCode).toBe("US");
      expect(upsBody.RateRequest.Shipment.ShipTo.Name).toBe("Test Recipient");
      expect(upsBody.RateRequest.Shipment.ShipTo.Address.City).toBe("Los Angeles");
      expect(upsBody.RateRequest.Shipment.Service).toBeUndefined(); // Shop mode
    });

    it("includes Service block when service level is specified", () => {
      const request = { ...sampleRateRequest(), serviceLevel: ServiceLevel.Ground } as DomainRateRequest;
      const upsBody = UpsRateMapper.toUpsRequest(request);

      expect(upsBody.RateRequest.Shipment.Service).toEqual({ Code: "03" });
    });

    it("maps overnight service to UPS code 01", () => {
      const request = { ...sampleRateRequest(), serviceLevel: ServiceLevel.Overnight } as DomainRateRequest;
      const upsBody = UpsRateMapper.toUpsRequest(request);

      expect(upsBody.RateRequest.Shipment.Service?.Code).toBe("01");
    });

    it("converts numeric weight to string", () => {
      const request = sampleRateRequest() as DomainRateRequest;
      const upsBody = UpsRateMapper.toUpsRequest(request);

      expect(upsBody.RateRequest.Shipment.Package[0].PackageWeight.Weight).toBe("5.5");
      expect(typeof upsBody.RateRequest.Shipment.Package[0].PackageWeight.Weight).toBe("string");
    });

    it("converts numeric dimensions to strings", () => {
      const request = sampleRateRequest() as DomainRateRequest;
      const upsBody = UpsRateMapper.toUpsRequest(request);

      const dims = upsBody.RateRequest.Shipment.Package[0].Dimensions!;
      expect(dims.Length).toBe("10");
      expect(dims.Width).toBe("8");
      expect(dims.Height).toBe("6");
    });

    it("omits dimensions when not provided", () => {
      const request = {
        ...sampleRateRequest(),
        packages: [{ weight: { value: 5, unit: "LBS" as const } }],
      } as DomainRateRequest;
      const upsBody = UpsRateMapper.toUpsRequest(request);

      expect(upsBody.RateRequest.Shipment.Package[0].Dimensions).toBeUndefined();
    });

    it("includes account number when provided", () => {
      const request = sampleRateRequest() as DomainRateRequest;
      const upsBody = UpsRateMapper.toUpsRequest(request, "ABC123");

      expect(upsBody.RateRequest.Shipment.Shipper.ShipperNumber).toBe("ABC123");
    });

    it("maps multiple packages", () => {
      const request = {
        ...sampleRateRequest(),
        packages: [
          { weight: { value: 5, unit: "LBS" as const } },
          { weight: { value: 10, unit: "LBS" as const } },
        ],
      } as DomainRateRequest;
      const upsBody = UpsRateMapper.toUpsRequest(request);

      expect(upsBody.RateRequest.Shipment.Package).toHaveLength(2);
      expect(upsBody.RateRequest.Shipment.Package[0].PackageWeight.Weight).toBe("5");
      expect(upsBody.RateRequest.Shipment.Package[1].PackageWeight.Weight).toBe("10");
    });
  });

  describe("fromUpsResponse", () => {
    it("maps array of RatedShipment to NormalizedRateQuote[]", () => {
      const quotes = UpsRateMapper.fromUpsResponse(fixtures.rateShopResponse());

      expect(quotes).toHaveLength(3);
      expect(quotes[0].carrier).toBe("ups");
      expect(quotes[0].serviceCode).toBe("03");
      expect(quotes[0].serviceName).toBe("UPS Ground");
      expect(quotes[0].serviceLevel).toBe(ServiceLevel.Ground);
      expect(quotes[0].totalCharges).toEqual({ amount: "18.50", currency: "USD" });
      expect(quotes[0].transitDays).toBe(5);
      expect(quotes[0].guaranteedDelivery).toBe(true);
    });

    it("handles single RatedShipment as object (not array)", () => {
      const quotes = UpsRateMapper.fromUpsResponse(fixtures.rateSingleServiceResponse());

      expect(quotes).toHaveLength(1);
      expect(quotes[0].serviceCode).toBe("03");
      expect(quotes[0].totalCharges.amount).toBe("18.50");
    });

    it("maps UPS service codes to domain ServiceLevel", () => {
      const quotes = UpsRateMapper.fromUpsResponse(fixtures.rateShopResponse());

      const ground = quotes.find((q) => q.serviceCode === "03");
      const twoDay = quotes.find((q) => q.serviceCode === "02");
      const nextDay = quotes.find((q) => q.serviceCode === "01");

      expect(ground?.serviceLevel).toBe(ServiceLevel.Ground);
      expect(twoDay?.serviceLevel).toBe(ServiceLevel.TwoDay);
      expect(nextDay?.serviceLevel).toBe(ServiceLevel.Overnight);
    });

    it("extracts rated package details", () => {
      const quotes = UpsRateMapper.fromUpsResponse(fixtures.rateShopResponse());

      expect(quotes[0].ratedPackages).toHaveLength(1);
      expect(quotes[0].ratedPackages[0].baseCharge).toBe("15.00");
      expect(quotes[0].ratedPackages[0].totalCharge).toBe("18.50");
      expect(quotes[0].ratedPackages[0].weight).toBe("5.5");
    });

    it("filters out generic success alerts from warnings", () => {
      const quotes = UpsRateMapper.fromUpsResponse(fixtures.rateShopResponse());
      // Alert code 110001 (Success) should be filtered
      expect(quotes[0].warnings).toEqual([]);
    });

    it("returns transitDays as null when GuaranteedDaysToDelivery is empty", () => {
      const modified = fixtures.rateShopResponse() as any;
      modified.RateResponse.RatedShipment[0].GuaranteedDaysToDelivery = "";
      const quotes = UpsRateMapper.fromUpsResponse(modified);
      expect(quotes[0].transitDays).toBeNull();
      expect(quotes[0].guaranteedDelivery).toBe(false);
    });

    it("throws CarrierError with malformed_response on invalid data", () => {
      expect(() => UpsRateMapper.fromUpsResponse({ invalid: "data" })).toThrow(CarrierError);
      try {
        UpsRateMapper.fromUpsResponse({ invalid: "data" });
      } catch (err) {
        expect((err as CarrierError).code).toBe("malformed_response");
      }
    });
  });

  describe("mapServiceCodeToLevel", () => {
    it("maps known service codes", () => {
      expect(UpsRateMapper.mapServiceCodeToLevel("03")).toBe(ServiceLevel.Ground);
      expect(UpsRateMapper.mapServiceCodeToLevel("02")).toBe(ServiceLevel.TwoDay);
      expect(UpsRateMapper.mapServiceCodeToLevel("01")).toBe(ServiceLevel.Overnight);
      expect(UpsRateMapper.mapServiceCodeToLevel("12")).toBe(ServiceLevel.ThreeDay);
      expect(UpsRateMapper.mapServiceCodeToLevel("13")).toBe(ServiceLevel.Express);
    });

    it("returns null for unknown service codes", () => {
      expect(UpsRateMapper.mapServiceCodeToLevel("99")).toBeNull();
    });
  });
});
