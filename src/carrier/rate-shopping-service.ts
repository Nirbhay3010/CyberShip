import { AggregateCarrierError, CarrierError } from "../domain/errors.js";
import { DomainRateRequestSchema, type DomainRateRequest } from "../domain/rate-request.js";
import type { NormalizedRateQuote } from "../domain/rate-response.js";
import { type CarrierProvider, isRateCapable } from "./carrier-provider.js";

export class RateShoppingService {
  private readonly rateProviders: (CarrierProvider & { rate(req: DomainRateRequest): Promise<NormalizedRateQuote[]> })[];

  constructor(providers: CarrierProvider[]) {
    if (providers.length === 0) {
      throw new Error("RateShoppingService requires at least one carrier provider");
    }

    this.rateProviders = providers.filter(isRateCapable);

    if (this.rateProviders.length === 0) {
      throw new Error("RateShoppingService requires at least one rate-capable carrier provider");
    }
  }

  async getRates(request: DomainRateRequest): Promise<NormalizedRateQuote[]> {
    const validated = DomainRateRequestSchema.parse(request);

    const results = await Promise.allSettled(
      this.rateProviders.map((provider) => provider.rate(validated)),
    );

    const quotes: NormalizedRateQuote[] = [];
    const errors: CarrierError[] = [];

    for (const result of results) {
      if (result.status === "fulfilled") {
        quotes.push(...result.value);
      } else {
        const err = result.reason;
        if (err instanceof CarrierError) {
          errors.push(err);
        } else {
          errors.push(
            new CarrierError(
              err instanceof Error ? err.message : String(err),
              "unknown",
              "unexpected_error",
            ),
          );
        }
      }
    }

    if (quotes.length === 0 && errors.length > 0) {
      throw new AggregateCarrierError(errors);
    }

    quotes.sort(
      (a, b) => parseFloat(a.totalCharges.amount) - parseFloat(b.totalCharges.amount),
    );

    return quotes;
  }
}
