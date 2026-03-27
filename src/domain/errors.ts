export class CarrierError extends Error {
  constructor(
    message: string,
    public readonly carrier: string,
    public readonly code: string,
    public readonly httpStatus?: number,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "CarrierError";
  }
}

export class AuthenticationError extends CarrierError {
  constructor(carrier: string, message: string, httpStatus?: number, cause?: unknown) {
    super(message, carrier, "authentication_error", httpStatus, cause);
    this.name = "AuthenticationError";
  }
}

export class RateLimitError extends CarrierError {
  public readonly retryAfterMs?: number;

  constructor(carrier: string, message: string, retryAfterMs?: number, cause?: unknown) {
    super(message, carrier, "rate_limit", 429, cause);
    this.name = "RateLimitError";
    this.retryAfterMs = retryAfterMs;
  }
}

export class ValidationError extends CarrierError {
  constructor(carrier: string, message: string, code: string, cause?: unknown) {
    super(message, carrier, code, 400, cause);
    this.name = "ValidationError";
  }
}

export class NetworkError extends CarrierError {
  constructor(carrier: string, message: string, cause?: unknown) {
    super(message, carrier, "network_error", undefined, cause);
    this.name = "NetworkError";
  }
}

export class TimeoutError extends CarrierError {
  constructor(carrier: string, message: string, cause?: unknown) {
    super(message, carrier, "timeout", undefined, cause);
    this.name = "TimeoutError";
  }
}

export class AggregateCarrierError extends Error {
  constructor(public readonly errors: CarrierError[]) {
    const summary = errors.map((e) => `${e.carrier}: ${e.message}`).join("; ");
    super(`All carriers failed: ${summary}`);
    this.name = "AggregateCarrierError";
  }
}
