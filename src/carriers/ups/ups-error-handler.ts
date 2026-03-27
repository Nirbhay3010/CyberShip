import {
  AuthenticationError,
  CarrierError,
  RateLimitError,
  ValidationError,
} from "../../domain/errors.js";
import type { HttpResponse } from "../../http/http-client.js";
import { UpsErrorResponseSchema } from "./types/rating-response.js";

export class UpsErrorHandler {
  assertSuccess(response: HttpResponse): void {
    if (response.status >= 200 && response.status < 300) {
      return;
    }

    if (response.status === 401) {
      throw new AuthenticationError("ups", this.extractMessage(response) ?? "Unauthorized", 401);
    }

    if (response.status === 403) {
      throw new AuthenticationError(
        "ups",
        this.extractMessage(response) ?? "Forbidden — account may be blocked",
        403,
      );
    }

    if (response.status === 429) {
      const retryAfter = response.headers["retry-after"];
      const parsedRetryAfter = retryAfter ? parseInt(retryAfter, 10) : NaN;
      const retryAfterMs = !isNaN(parsedRetryAfter) ? parsedRetryAfter * 1000 : undefined;
      throw new RateLimitError(
        "ups",
        this.extractMessage(response) ?? "Rate limit exceeded",
        retryAfterMs,
      );
    }

    if (response.status >= 400 && response.status < 500) {
      const parsed = UpsErrorResponseSchema.safeParse(response.data);
      if (parsed.success && parsed.data.response.errors.length > 0) {
        const firstError = parsed.data.response.errors[0];
        throw new ValidationError("ups", firstError.message, firstError.code);
      }
      throw new ValidationError(
        "ups",
        this.extractMessage(response) ?? `Request failed with status ${response.status}`,
        "unknown",
      );
    }

    throw new CarrierError(
      this.extractMessage(response) ?? `UPS API error with status ${response.status}`,
      "ups",
      "server_error",
      response.status,
    );
  }

  private extractMessage(response: HttpResponse): string | undefined {
    const data = response.data;
    if (typeof data !== "object" || data === null) return undefined;

    const parsed = UpsErrorResponseSchema.safeParse(data);
    if (parsed.success && parsed.data.response.errors.length > 0) {
      return parsed.data.response.errors.map((e) => e.message).join("; ");
    }

    return undefined;
  }
}
