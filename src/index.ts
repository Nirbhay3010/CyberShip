// Domain
export { ServiceLevel } from "./domain/models.js";
export type { Address, Package, PackageDimensions } from "./domain/models.js";
export type { DomainRateRequest } from "./domain/rate-request.js";
export { DomainRateRequestSchema } from "./domain/rate-request.js";
export type { NormalizedRateQuote, RatedPackageDetail } from "./domain/rate-response.js";
export {
  CarrierError,
  AuthenticationError,
  RateLimitError,
  ValidationError,
  NetworkError,
  TimeoutError,
  AggregateCarrierError,
} from "./domain/errors.js";

// Carrier abstraction
export type { CarrierProvider, RateCapable } from "./carrier/carrier-provider.js";
export { isRateCapable } from "./carrier/carrier-provider.js";
export { CarrierFactory } from "./carrier/carrier-factory.js";
export { RateShoppingService } from "./carrier/rate-shopping-service.js";

// HTTP
export { FetchHttpClient } from "./http/http-client.js";
export type { HttpClient, HttpRequestConfig, HttpResponse } from "./http/http-client.js";
export { RetryableHttpClient, DEFAULT_RETRY_CONFIG } from "./http/retry.js";
export type { RetryConfig } from "./http/retry.js";

// Config
export { loadConfig } from "./config.js";
export type { AppConfig } from "./config.js";

// UPS carrier
export { UpsProvider, createUpsConfig } from "./carriers/ups/index.js";
export type { UpsConfig } from "./carriers/ups/index.js";
