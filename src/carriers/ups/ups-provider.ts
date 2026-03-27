import type { CarrierProvider, RateCapable } from "../../carrier/carrier-provider.js";
import type { DomainRateRequest } from "../../domain/rate-request.js";
import type { NormalizedRateQuote } from "../../domain/rate-response.js";
import type { HttpClient } from "../../http/http-client.js";
import { RetryableHttpClient, type RetryConfig } from "../../http/retry.js";
import { UpsAuthManager } from "./ups-auth.js";
import type { UpsConfig } from "./ups-config.js";
import { UpsHttpClient } from "./ups-http-client.js";
import { UpsRatingOperation } from "./ups-rating-operation.js";

export class UpsProvider implements CarrierProvider, RateCapable {
  readonly carrierName = "ups";
  private readonly ratingOperation: UpsRatingOperation;

  constructor(httpClient: HttpClient, config: UpsConfig, retryConfig?: Partial<RetryConfig>) {
    const retryableClient = new RetryableHttpClient(httpClient, retryConfig);
    const authManager = new UpsAuthManager(retryableClient, config);
    const upsHttpClient = new UpsHttpClient(retryableClient, authManager);
    this.ratingOperation = new UpsRatingOperation(upsHttpClient, config);
  }

  async rate(request: DomainRateRequest): Promise<NormalizedRateQuote[]> {
    return this.ratingOperation.execute(request);
  }
}
