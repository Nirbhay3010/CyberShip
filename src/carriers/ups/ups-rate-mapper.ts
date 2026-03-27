import type { Address, Package } from "../../domain/models.js";
import { ServiceLevel } from "../../domain/models.js";
import type { DomainRateRequest } from "../../domain/rate-request.js";
import type { NormalizedRateQuote, RatedPackageDetail } from "../../domain/rate-response.js";
import { CarrierError } from "../../domain/errors.js";
import { UPS_SERVICE_CODES, SERVICE_LEVEL_TO_UPS_CODE, PACKAGING_TYPES, UPS_SUCCESS_ALERT_CODE } from "./types/common.js";
import type { UpsRateRequestBody, UpsAddress, UpsPackage } from "./types/rating-request.js";
import { UpsRateResponseSchema } from "./types/rating-response.js";
import type { UpsRatedShipment, UpsRatedPackage } from "./types/rating-response.js";

export class UpsRateMapper {
  static resolveRequestOption(request: DomainRateRequest): "Rate" | "Shop" {
    return request.serviceLevel ? "Rate" : "Shop";
  }

  static toUpsRequest(request: DomainRateRequest, accountNumber?: string): UpsRateRequestBody {
    const shipperAddress = this.mapAddress(request.origin);
    const shipToAddress = this.mapAddress(request.destination);

    const body: UpsRateRequestBody = {
      RateRequest: {
        Request: {
          SubVersion: "2409",
        },
        Shipment: {
          Shipper: {
            Name: request.origin.name ?? "Shipper",
            ...(accountNumber ? { ShipperNumber: accountNumber } : {}),
            Address: shipperAddress,
          },
          ShipTo: {
            Name: request.destination.name ?? "Recipient",
            Address: shipToAddress,
          },
          ShipFrom: {
            Name: request.origin.name ?? "Shipper",
            Address: shipperAddress,
          },
          Package: request.packages.map((pkg) => this.mapPackage(pkg)),
        },
      },
    };

    if (request.serviceLevel) {
      const upsCode = SERVICE_LEVEL_TO_UPS_CODE[request.serviceLevel];
      body.RateRequest.Shipment.Service = { Code: upsCode };
    }

    return body;
  }

  static fromUpsResponse(data: unknown): NormalizedRateQuote[] {
    const parsed = UpsRateResponseSchema.safeParse(data);
    if (!parsed.success) {
      throw new CarrierError(
        `Malformed UPS rate response: ${parsed.error.message}`,
        "ups",
        "malformed_response",
        undefined,
        parsed.error,
      );
    }

    const rateResponse = parsed.data.RateResponse;
    const shipments = Array.isArray(rateResponse.RatedShipment)
      ? rateResponse.RatedShipment
      : [rateResponse.RatedShipment];

    const globalWarnings = this.extractAlerts(rateResponse.Response.Alert);

    return shipments.map((shipment) => this.mapRatedShipment(shipment, globalWarnings));
  }

  static mapServiceCodeToLevel(code: string): ServiceLevel | null {
    return UPS_SERVICE_CODES[code]?.level ?? null;
  }

  private static mapRatedShipment(
    shipment: UpsRatedShipment,
    globalWarnings: string[],
  ): NormalizedRateQuote {
    const serviceCode = shipment.Service.Code;
    const serviceInfo = UPS_SERVICE_CODES[serviceCode];
    const ratedPackages = Array.isArray(shipment.RatedPackage)
      ? shipment.RatedPackage
      : [shipment.RatedPackage];

    const shipmentWarnings = this.extractAlerts(shipment.RatedShipmentAlert);

    let transitDays: number | null = null;
    if (shipment.GuaranteedDaysToDelivery && shipment.GuaranteedDaysToDelivery !== "") {
      transitDays = parseInt(shipment.GuaranteedDaysToDelivery, 10);
      if (isNaN(transitDays)) transitDays = null;
    }

    return {
      carrier: "ups",
      serviceCode,
      serviceName: serviceInfo?.name ?? shipment.Service.Description ?? `UPS Service ${serviceCode}`,
      serviceLevel: serviceInfo?.level ?? null,
      totalCharges: {
        amount: shipment.TotalCharges.MonetaryValue,
        currency: shipment.TotalCharges.CurrencyCode,
      },
      transitDays,
      guaranteedDelivery: transitDays !== null,
      ratedPackages: ratedPackages.map((pkg) => this.mapRatedPackage(pkg)),
      warnings: [...globalWarnings, ...shipmentWarnings],
    };
  }

  private static mapRatedPackage(pkg: UpsRatedPackage): RatedPackageDetail {
    return {
      baseCharge: pkg.BaseServiceCharge?.MonetaryValue ?? pkg.TransportationCharges?.MonetaryValue ?? "0.00",
      totalCharge: pkg.TransportationCharges?.MonetaryValue ?? "0.00",
      currency: pkg.TransportationCharges?.CurrencyCode ?? pkg.BaseServiceCharge?.CurrencyCode ?? "USD",
      weight: pkg.Weight?.Weight ?? pkg.BillingWeight?.Weight ?? "0",
    };
  }

  private static mapAddress(address: Address): UpsAddress {
    const lines = [address.addressLine1];
    if (address.addressLine2) lines.push(address.addressLine2);

    return {
      AddressLine: lines,
      City: address.city,
      StateProvinceCode: address.stateProvinceCode,
      PostalCode: address.postalCode,
      CountryCode: address.countryCode,
    };
  }

  private static mapPackage(pkg: Package): UpsPackage {
    const upsPackage: UpsPackage = {
      PackagingType: {
        Code: pkg.packagingType ?? PACKAGING_TYPES.CUSTOMER_SUPPLIED,
      },
      PackageWeight: {
        UnitOfMeasurement: { Code: pkg.weight.unit },
        Weight: String(pkg.weight.value),
      },
    };

    if (pkg.dimensions) {
      upsPackage.Dimensions = {
        UnitOfMeasurement: { Code: pkg.dimensions.unit },
        Length: String(pkg.dimensions.length),
        Width: String(pkg.dimensions.width),
        Height: String(pkg.dimensions.height),
      };
    }

    return upsPackage;
  }

  private static extractAlerts(
    alerts: Array<{ Code: string; Description: string }> | { Code: string; Description: string } | undefined,
  ): string[] {
    if (!alerts) return [];
    const arr = Array.isArray(alerts) ? alerts : [alerts];
    return arr
      .filter((a) => a.Code !== UPS_SUCCESS_ALERT_CODE)
      .map((a) => `${a.Code}: ${a.Description}`);
  }
}
