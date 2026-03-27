import { ServiceLevel } from "./models.js";

export interface RatedPackageDetail {
  baseCharge: string;
  totalCharge: string;
  currency: string;
  weight: string;
}

export interface NormalizedRateQuote {
  carrier: string;
  serviceCode: string;
  serviceName: string;
  serviceLevel: ServiceLevel | null;
  totalCharges: {
    amount: string;
    currency: string;
  };
  transitDays: number | null;
  guaranteedDelivery: boolean;
  ratedPackages: RatedPackageDetail[];
  warnings: string[];
}
