import { z } from "zod";

export const AddressSchema = z.object({
  name: z.string().optional(),
  addressLine1: z.string().min(1),
  addressLine2: z.string().optional(),
  city: z.string().min(1),
  stateProvinceCode: z.string().min(1),
  postalCode: z.string().min(1),
  countryCode: z.string().length(2),
});

export type Address = z.infer<typeof AddressSchema>;

export const PackageDimensionsSchema = z.object({
  length: z.number().positive(),
  width: z.number().positive(),
  height: z.number().positive(),
  unit: z.enum(["IN", "CM"]),
});

export type PackageDimensions = z.infer<typeof PackageDimensionsSchema>;

export const PackageSchema = z.object({
  weight: z.object({
    value: z.number().positive(),
    unit: z.enum(["LBS", "KGS"]),
  }),
  dimensions: PackageDimensionsSchema.optional(),
  packagingType: z.string().optional(),
});

export type Package = z.infer<typeof PackageSchema>;

export enum ServiceLevel {
  Ground = "ground",
  ThreeDay = "three_day",
  TwoDay = "two_day",
  Express = "express",
  Overnight = "overnight",
}
