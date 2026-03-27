import { z } from "zod";
import { AddressSchema, PackageSchema, ServiceLevel } from "./models.js";

export const DomainRateRequestSchema = z.object({
  origin: AddressSchema,
  destination: AddressSchema,
  packages: z.array(PackageSchema).min(1),
  serviceLevel: z.nativeEnum(ServiceLevel).optional(),
});

export type DomainRateRequest = z.infer<typeof DomainRateRequestSchema>;
