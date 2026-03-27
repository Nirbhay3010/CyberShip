import { z } from "zod";

export const ConfigSchema = z.object({
  UPS_CLIENT_ID: z.string().min(1, "UPS_CLIENT_ID is required"),
  UPS_CLIENT_SECRET: z.string().min(1, "UPS_CLIENT_SECRET is required"),
  UPS_ACCOUNT_NUMBER: z.string().optional(),
  UPS_ENVIRONMENT: z.enum(["sandbox", "production"]).default("sandbox"),
  REQUEST_TIMEOUT_MS: z.coerce.number().positive().default(10_000),
  RETRY_MAX_RETRIES: z.coerce.number().int().min(0).default(3),
  RETRY_BASE_DELAY_MS: z.coerce.number().positive().default(500),
  RETRY_MAX_DELAY_MS: z.coerce.number().positive().default(10_000),
});

export type AppConfig = z.infer<typeof ConfigSchema>;

export function loadConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  return ConfigSchema.parse(env);
}
