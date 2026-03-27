import { ServiceLevel } from "../../../domain/models.js";

export const UPS_SERVICE_CODES: Record<string, { name: string; level: ServiceLevel }> = {
  "01": { name: "UPS Next Day Air", level: ServiceLevel.Overnight },
  "02": { name: "UPS 2nd Day Air", level: ServiceLevel.TwoDay },
  "03": { name: "UPS Ground", level: ServiceLevel.Ground },
  "12": { name: "UPS 3 Day Select", level: ServiceLevel.ThreeDay },
  "13": { name: "UPS Next Day Air Saver", level: ServiceLevel.Express },
  "14": { name: "UPS Next Day Air Early", level: ServiceLevel.Overnight },
  "59": { name: "UPS 2nd Day Air A.M.", level: ServiceLevel.TwoDay },
};

export const SERVICE_LEVEL_TO_UPS_CODE: Record<ServiceLevel, string> = {
  [ServiceLevel.Ground]: "03",
  [ServiceLevel.ThreeDay]: "12",
  [ServiceLevel.TwoDay]: "02",
  [ServiceLevel.Express]: "13",
  [ServiceLevel.Overnight]: "01",
};

/** UPS returns this alert code on every successful response — filtered from warnings */
export const UPS_SUCCESS_ALERT_CODE = "110001";

export const PACKAGING_TYPES = {
  LETTER: "01",
  CUSTOMER_SUPPLIED: "02",
  TUBE: "03",
  PAK: "04",
  EXPRESS_BOX: "21",
} as const;
