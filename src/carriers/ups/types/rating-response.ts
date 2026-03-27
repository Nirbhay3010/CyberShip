import { z } from "zod";

const UpsChargeSchema = z.object({
  CurrencyCode: z.string(),
  MonetaryValue: z.string(),
});

const UpsSurChargeSchema = z.object({
  Code: z.string().optional(),
  Description: z.string().optional(),
  CurrencyCode: z.string().optional(),
  MonetaryValue: z.string().optional(),
});

const UpsRatedPackageSchema = z.object({
  TransportationCharges: UpsChargeSchema.optional(),
  BaseServiceCharge: UpsChargeSchema.optional(),
  ServiceOptionsCharges: UpsChargeSchema.optional(),
  ItemizedCharges: z.union([z.array(UpsSurChargeSchema), UpsSurChargeSchema]).optional(),
  Weight: z
    .object({
      UnitOfMeasurement: z.object({ Code: z.string() }).optional(),
      Weight: z.string(),
    })
    .optional(),
  BillingWeight: z
    .object({
      UnitOfMeasurement: z.object({ Code: z.string() }).optional(),
      Weight: z.string(),
    })
    .optional(),
});

const UpsAlertSchema = z.object({
  Code: z.string(),
  Description: z.string(),
});

const UpsRatedShipmentSchema = z.object({
  Service: z.object({
    Code: z.string(),
    Description: z.string().optional(),
  }),
  RatedPackage: z.union([z.array(UpsRatedPackageSchema), UpsRatedPackageSchema]),
  TotalCharges: UpsChargeSchema,
  GuaranteedDelivery: z
    .object({
      BusinessDaysInTransit: z.string().optional(),
    })
    .optional(),
  GuaranteedDaysToDelivery: z.string().optional(),
  ScheduledDeliveryTime: z.string().optional(),
  RatedShipmentAlert: z.union([z.array(UpsAlertSchema), UpsAlertSchema]).optional(),
});

export type UpsRatedShipment = z.infer<typeof UpsRatedShipmentSchema>;
export type UpsRatedPackage = z.infer<typeof UpsRatedPackageSchema>;

export const UpsRateResponseSchema = z.object({
  RateResponse: z.object({
    Response: z.object({
      ResponseStatus: z.object({
        Code: z.string(),
        Description: z.string(),
      }),
      Alert: z.union([z.array(UpsAlertSchema), UpsAlertSchema]).optional(),
      TransactionReference: z
        .object({
          CustomerContext: z.string().optional(),
          TransactionIdentifier: z.string().optional(),
        })
        .optional(),
    }),
    RatedShipment: z.union([z.array(UpsRatedShipmentSchema), UpsRatedShipmentSchema]),
  }),
});

export type UpsRateResponse = z.infer<typeof UpsRateResponseSchema>;

export const UpsErrorResponseSchema = z.object({
  response: z.object({
    errors: z.array(
      z.object({
        code: z.string(),
        message: z.string(),
      }),
    ),
  }),
});

export type UpsErrorResponse = z.infer<typeof UpsErrorResponseSchema>;
