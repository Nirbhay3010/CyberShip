import type { DomainRateRequest } from "../../domain/rate-request.js";
import type { NormalizedRateQuote } from "../../domain/rate-response.js";
import type { UpsConfig } from "./ups-config.js";
import type { UpsHttpClient } from "./ups-http-client.js";
import { UpsErrorHandler } from "./ups-error-handler.js";
import { UpsRateMapper } from "./ups-rate-mapper.js";

export class UpsRatingOperation {
  private readonly errorHandler = new UpsErrorHandler();

  constructor(
    private readonly httpClient: UpsHttpClient,
    private readonly config: UpsConfig,
  ) {}

  async execute(request: DomainRateRequest): Promise<NormalizedRateQuote[]> {
    const requestOption = UpsRateMapper.resolveRequestOption(request);
    const upsBody = UpsRateMapper.toUpsRequest(request, this.config.accountNumber);

    const url = `${this.config.baseUrl}/api/rating/${this.config.apiVersion}/${requestOption}`;

    const response = await this.httpClient.request({
      url,
      method: "POST",
      body: upsBody,
      timeoutMs: this.config.timeoutMs,
    });

    this.errorHandler.assertSuccess(response);

    return UpsRateMapper.fromUpsResponse(response.data);
  }
}
