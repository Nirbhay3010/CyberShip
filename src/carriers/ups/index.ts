import { CarrierFactory } from "../../carrier/carrier-factory.js";
import { ConfigSchema } from "../../config.js";
import { UpsProvider } from "./ups-provider.js";
import { createUpsConfig } from "./ups-config.js";

// Self-register UPS with the carrier factory on import
CarrierFactory.register("ups", {
  create(httpClient, env) {
    const config = ConfigSchema.parse(env);
    const upsConfig = createUpsConfig(config);
    const retryConfig = {
      maxRetries: config.RETRY_MAX_RETRIES,
      baseDelayMs: config.RETRY_BASE_DELAY_MS,
      maxDelayMs: config.RETRY_MAX_DELAY_MS,
    };
    return new UpsProvider(httpClient, upsConfig, retryConfig);
  },
});

export { UpsProvider } from "./ups-provider.js";
export { createUpsConfig } from "./ups-config.js";
export type { UpsConfig } from "./ups-config.js";
