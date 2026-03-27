export interface UpsAddress {
  AddressLine: string[];
  City: string;
  StateProvinceCode: string;
  PostalCode: string;
  CountryCode: string;
}

export interface UpsShipper {
  Name: string;
  ShipperNumber?: string;
  Address: UpsAddress;
}

export interface UpsShipTo {
  Name: string;
  Address: UpsAddress;
}

export interface UpsShipFrom {
  Name: string;
  Address: UpsAddress;
}

export interface UpsPackage {
  PackagingType: {
    Code: string;
    Description?: string;
  };
  Dimensions?: {
    UnitOfMeasurement: { Code: string; Description?: string };
    Length: string;
    Width: string;
    Height: string;
  };
  PackageWeight: {
    UnitOfMeasurement: { Code: string; Description?: string };
    Weight: string;
  };
}

export interface UpsRateRequestBody {
  RateRequest: {
    Request: {
      SubVersion?: string;
      TransactionReference?: { CustomerContext?: string };
    };
    Shipment: {
      Shipper: UpsShipper;
      ShipTo: UpsShipTo;
      ShipFrom: UpsShipFrom;
      Package: UpsPackage[];
      Service?: { Code: string; Description?: string };
      ShipmentRatingOptions?: { NegotiatedRatesIndicator?: string };
      PaymentDetails?: { ShipmentCharge?: { Type: string } };
    };
  };
}
