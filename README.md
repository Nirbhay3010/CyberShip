# Cybership Carrier Integration Service

A production-grade TypeScript shipping carrier integration service that wraps the UPS Rating API to fetch shipping rates. Built with extensibility at its core — designed so adding new carriers (FedEx, USPS, DHL) and new operations (label purchase, tracking, address validation) requires zero changes to existing code.

## Table of Contents

- [Quick Start](#quick-start)
- [Usage](#usage)
- [Architecture Deep Dive](#architecture-deep-dive)
- [Domain Model](#domain-model)
- [Authentication](#authentication)
- [Retry & Resilience](#retry--resilience)
- [Error Handling](#error-handling)
- [Validation Strategy](#validation-strategy)
- [Configuration](#configuration)
- [Testing](#testing)
- [Postman Collection](#postman-collection)
- [Extending the Service](#extending-the-service)
- [Design Decisions](#design-decisions)
- [What I Would Improve Given More Time](#what-i-would-improve-given-more-time)

---

## Quick Start

```bash
# Install dependencies
pnpm install

# Copy and configure environment variables
cp .env.example .env

# Run tests
pnpm test

# Run tests with coverage
pnpm test:coverage

# Type check
pnpm run typecheck

# Build
pnpm run build
```

**Requirements:** Node.js >= 18.0.0, pnpm

---

## Usage

### Direct Instantiation

```typescript
import {
  RateShoppingService,
  UpsProvider,
  FetchHttpClient,
  createUpsConfig,
  loadConfig,
  ServiceLevel,
} from "cybership-carrier-integration";

// Load config from environment
const appConfig = loadConfig();
const upsConfig = createUpsConfig(appConfig);

// Create providers and service
const httpClient = new FetchHttpClient();
const upsProvider = new UpsProvider(httpClient, upsConfig);
const rateService = new RateShoppingService([upsProvider]);

// Get rates — shop all available services
const quotes = await rateService.getRates({
  origin: {
    name: "Warehouse A",
    addressLine1: "123 Main St",
    city: "New York",
    stateProvinceCode: "NY",
    postalCode: "10001",
    countryCode: "US",
  },
  destination: {
    name: "Customer",
    addressLine1: "456 Oak Ave",
    city: "Los Angeles",
    stateProvinceCode: "CA",
    postalCode: "90001",
    countryCode: "US",
  },
  packages: [
    {
      weight: { value: 5.5, unit: "LBS" },
      dimensions: { length: 10, width: 8, height: 6, unit: "IN" },
    },
  ],
});

// quotes is NormalizedRateQuote[], sorted by price ascending
// [
//   { carrier: "ups", serviceName: "UPS Ground",       totalCharges: { amount: "18.50", currency: "USD" }, transitDays: 5, ... },
//   { carrier: "ups", serviceName: "UPS 2nd Day Air",  totalCharges: { amount: "32.75", currency: "USD" }, transitDays: 2, ... },
//   { carrier: "ups", serviceName: "UPS Next Day Air", totalCharges: { amount: "58.99", currency: "USD" }, transitDays: 1, ... },
// ]

// Or request a specific service level
const groundQuotes = await rateService.getRates({
  // ...same origin/destination/packages
  serviceLevel: ServiceLevel.Ground,
});
```

### Using CarrierFactory (Dynamic Registration)

Carriers self-register with the factory on import. This pattern supports dynamic instantiation from configuration without hardcoded carrier dependencies:

```typescript
import { CarrierFactory, RateShoppingService, FetchHttpClient } from "cybership-carrier-integration";
// Side-effect import triggers UPS self-registration
import "cybership-carrier-integration/carriers/ups";

const httpClient = new FetchHttpClient();

// Create all registered carriers (reads config from process.env)
const providers = CarrierFactory.createAll(httpClient);
const rateService = new RateShoppingService(providers);

// Or create a specific carrier
const ups = CarrierFactory.create("ups", httpClient);
```

### Custom Retry Configuration

```typescript
const upsProvider = new UpsProvider(httpClient, upsConfig, {
  maxRetries: 5,       // Up to 5 retry attempts
  baseDelayMs: 1000,   // Start at 1 second
  maxDelayMs: 30000,   // Cap at 30 seconds
  backoffMultiplier: 2, // Double each time
  jitter: true,         // ±25% randomization to prevent thundering herd
});
```

---

## Architecture Deep Dive

### High-Level Architecture

```
┌───────────────────────────────────────────────────────────────────┐
│                        Caller / Consumer                         │
└──────────────────────────────┬────────────────────────────────────┘
                               │
                    ┌──────────▼──────────┐
                    │  RateShoppingService │  Filters to RateCapable
                    │  - Zod validation    │  carriers, fans out via
                    │  - Sort by price     │  Promise.allSettled
                    └──────────┬──────────┘
                               │
               ┌───────────────┼───────────────┐
               │               │               │
       ┌───────▼──────┐ ┌─────▼──────┐ ┌──────▼──────┐
       │  UpsProvider  │ │FedExProvider│ │ USPSProvider │
       │  Rate+Label   │ │ Rate only  │ │ Rate+Track  │
       └───────┬──────┘ └────────────┘ └─────────────┘
               │
    ┌──────────▼───────────┐
    │  UpsRatingOperation  │  Orchestrates a single UPS rate call
    └──────────┬───────────┘
               │
    ┌──────────▼───────────┐
    │    UpsHttpClient     │  Injects Bearer token, auto-retries on 401
    └──────────┬───────────┘
               │
    ┌──────────▼───────────┐
    │  RetryableHttpClient │  Exponential backoff for 5xx, 429, timeouts
    └──────────┬───────────┘
               │
    ┌──────────▼───────────┐
    │   FetchHttpClient    │  Raw HTTP via native fetch + AbortController
    └──────────────────────┘
```

### Request/Response Call Flow

```
RateShoppingService.getRates(DomainRateRequest)
  │
  ├── 1. Zod validate input → DomainRateRequestSchema.parse()
  │
  ├── 2. Fan out to all providers via Promise.allSettled()
  │     │
  │     └── UpsProvider.rate(request)
  │           │
  │           └── UpsRatingOperation.execute(request)
  │                 │
  │                 ├── UpsRateMapper.resolveRequestOption()
  │                 │     → "Shop" (all services) or "Rate" (specific service)
  │                 │
  │                 ├── UpsRateMapper.toUpsRequest()
  │                 │     → Domain types → UPS API request body
  │                 │
  │                 ├── UpsHttpClient.request()
  │                 │     │
  │                 │     ├── UpsAuthManager.getAccessToken()
  │                 │     │     → Cached? Return token
  │                 │     │     → Expired? Fetch new (deduplicated)
  │                 │     │
  │                 │     ├── Inject Bearer token in Authorization header
  │                 │     │
  │                 │     ├── RetryableHttpClient.request()
  │                 │     │     │
  │                 │     │     └── FetchHttpClient.request()
  │                 │     │           → POST /api/rating/{version}/{Shop|Rate}
  │                 │     │           → AbortController timeout
  │                 │     │
  │                 │     │     If 5xx/429/timeout → exponential backoff + retry
  │                 │     │
  │                 │     └── If 401 → invalidate token → fetch fresh → retry once
  │                 │
  │                 ├── UpsErrorHandler.assertSuccess(response)
  │                 │     → 2xx: pass through
  │                 │     → 4xx/5xx: throw structured CarrierError
  │                 │
  │                 └── UpsRateMapper.fromUpsResponse()
  │                       → Zod validate response schema
  │                       → UPS types → NormalizedRateQuote[]
  │
  ├── 3. Collect: successful quotes + errors
  │     → If ALL fail: throw AggregateCarrierError
  │     → If some succeed: return partial results
  │
  └── 4. Sort quotes by price (ascending) → return NormalizedRateQuote[]
```

### Project Structure

```
src/
├── index.ts                        # Public API — all exports
├── config.ts                       # Zod-validated env config
│
├── domain/                         # Carrier-agnostic domain layer
│   ├── models.ts                   #   Address, Package, ServiceLevel
│   ├── rate-request.ts             #   DomainRateRequest + Zod schema
│   ├── rate-response.ts            #   NormalizedRateQuote, RatedPackageDetail
│   └── errors.ts                   #   Error class hierarchy
│
├── http/                           # HTTP abstraction layer
│   ├── http-client.ts              #   HttpClient interface + FetchHttpClient
│   └── retry.ts                    #   RetryableHttpClient (exponential backoff)
│
├── carrier/                        # Carrier abstraction layer
│   ├── carrier-provider.ts         #   CarrierProvider + capability interfaces (RateCapable, etc.)
│   ├── carrier-factory.ts          #   Self-registration registry + factory
│   └── rate-shopping-service.ts    #   Multi-carrier orchestration
│
└── carriers/
    └── ups/                        # UPS-specific implementation
        ├── index.ts                #   Self-registers with CarrierFactory
        ├── ups-provider.ts         #   CarrierProvider implementation
        ├── ups-config.ts           #   UPS config (sandbox/production URLs)
        ├── ups-auth.ts             #   OAuth 2.0 token manager
        ├── ups-http-client.ts      #   Bearer token injection + 401 retry
        ├── ups-rating-operation.ts #   Rate endpoint orchestrator
        ├── ups-rate-mapper.ts      #   Domain ↔ UPS type translation
        ├── ups-error-handler.ts    #   HTTP status → structured error mapping
        └── types/
            ├── auth.ts             #   OAuth response Zod schema
            ├── common.ts           #   UPS service codes, packaging types
            ├── rating-request.ts   #   UPS API request interfaces
            └── rating-response.ts  #   UPS API response Zod schemas

tests/
├── helpers/
│   ├── fixtures.ts                 # Fixture loader + sample request factory
│   └── mock-http-client.ts         # MockHttpClient for test stubbing
├── fixtures/ups/                   # Realistic UPS API response payloads
│   ├── oauth-token-response.json
│   ├── rate-shop-response.json
│   ├── rate-single-service-response.json
│   ├── rate-error-invalid-address.json
│   ├── rate-error-auth-failure.json
│   └── rate-error-rate-limit.json
├── unit/                           # Isolated unit tests (10 files)
└── integration/                    # End-to-end flow tests (3 files)
```

### Design Patterns Used

| Pattern | Where | Purpose |
|---------|-------|---------|
| **Strategy** | `CarrierProvider` interface | Each carrier is a pluggable strategy — UPS, FedEx, USPS implement the same contract |
| **Capability** | `RateCapable`, `LabelCapable`, etc. | Operations are opt-in interfaces — carriers implement only what they support; adding a new operation never forces changes on existing carriers |
| **Adapter** | `UpsRateMapper` | Translates between carrier-agnostic domain types and vendor-specific API schemas |
| **Decorator** | `RetryableHttpClient` → `HttpClient` | Wraps any HTTP client with retry logic without modifying the original |
| **Interceptor** | `UpsHttpClient` wraps `HttpClient` | Transparently injects auth tokens and handles 401 refresh |
| **Self-Registration** | `CarrierFactory.register()` on import | Carriers register themselves — no central switch/if-else; new carriers just import |
| **Factory** | `CarrierFactory.create()` / `createAll()` | Dynamic carrier instantiation from configuration |

---

## Domain Model

The service defines carrier-agnostic domain types that form the contract between callers and the service. No UPS-specific types leak to the caller.

### Input: `DomainRateRequest`

```typescript
interface DomainRateRequest {
  origin: Address;          // Shipping origin
  destination: Address;     // Shipping destination
  packages: Package[];      // At least 1 package
  serviceLevel?: ServiceLevel; // Optional — omit to shop all services
}

interface Address {
  name?: string;            // Contact name (optional)
  addressLine1: string;
  addressLine2?: string;
  city: string;
  stateProvinceCode: string;
  postalCode: string;
  countryCode: string;      // ISO 3166 2-char (e.g., "US")
}

interface Package {
  weight: { value: number; unit: "LBS" | "KGS" };
  dimensions?: { length: number; width: number; height: number; unit: "IN" | "CM" };
  packagingType?: string;   // UPS packaging code (default: customer-supplied)
}

enum ServiceLevel {
  Ground    = "ground",
  ThreeDay  = "three_day",
  TwoDay    = "two_day",
  Express   = "express",
  Overnight = "overnight",
}
```

### Output: `NormalizedRateQuote`

```typescript
interface NormalizedRateQuote {
  carrier: string;              // "ups", "fedex", etc.
  serviceCode: string;          // Carrier-specific code (e.g., "03" for UPS Ground)
  serviceName: string;          // Human-readable name
  serviceLevel: ServiceLevel | null;
  totalCharges: {
    amount: string;             // String to preserve decimal precision
    currency: string;           // ISO 4217 (e.g., "USD")
  };
  transitDays: number | null;
  guaranteedDelivery: boolean;
  ratedPackages: RatedPackageDetail[];
  warnings: string[];           // Carrier alerts (filtered, no noise)
}

interface RatedPackageDetail {
  baseCharge: string;
  totalCharge: string;
  currency: string;
  weight: string;
}
```

**Key decision:** Currency amounts are strings (`"18.50"`, not `18.5`) to avoid IEEE 754 floating-point precision errors. This is critical for financial data.

---

## Authentication

The service implements the full UPS OAuth 2.0 client-credentials flow with production-grade token lifecycle management.

### Flow

```
1. First API call triggers token acquisition
   ├── Base64 encode clientId:clientSecret
   ├── POST /security/v1/oauth/token
   │     Authorization: Basic <base64>
   │     Content-Type: application/x-www-form-urlencoded
   │     Body: grant_type=client_credentials
   └── Response: { access_token, expires_in: 14399, ... }

2. Token is cached in memory
   └── expiresAt = now + expires_in - 60s margin
       (60s buffer prevents using a token that expires mid-flight)

3. Subsequent calls reuse cached token
   └── Bearer token injected automatically in Authorization header

4. Concurrent request deduplication
   └── If 10 requests arrive while token is being fetched,
       all 10 share the single in-flight promise (no 10 OAuth calls)

5. Transparent 401 retry
   ├── If an API call returns 401:
   │     1. Invalidate cached token
   │     2. Fetch a fresh token
   │     3. Retry the request once
   └── If the retry also returns 401: propagate the error (no infinite loop)
```

### Why This Matters

- **Token caching** avoids an OAuth round-trip on every API call (~200ms saved per request)
- **Concurrent deduplication** prevents thundering herd — 100 simultaneous requests produce 1 OAuth call, not 100
- **60-second expiry margin** prevents mid-flight token expiry (a request started at T-1s would fail)
- **Transparent 401 retry** handles transient auth failures without caller involvement

---

## Retry & Resilience

The `RetryableHttpClient` is an HTTP client decorator that adds automatic retry with exponential backoff. It sits in the HTTP layer and is transparent to all carrier-specific code.

### What Gets Retried

| Failure Type | Retried? | Rationale |
|-------------|----------|-----------|
| 5xx (Server Error) | Yes | UPS infrastructure hiccup — typically recovers quickly |
| 429 (Rate Limit) | Yes | Respects `Retry-After` header when present |
| Network Error | Yes | Connection refused, DNS failure — transient |
| Timeout | Yes | Server slow but may recover |
| 4xx (Client Error) | No | Invalid input won't become valid on retry |
| 401/403 (Auth) | No | Handled separately by `UpsHttpClient` token refresh |

### Backoff Strategy

```
Attempt 0 (initial):    immediately
Attempt 1 (1st retry):  500ms  × 2^0 = 500ms   (±25% jitter)
Attempt 2 (2nd retry):  500ms  × 2^1 = 1000ms  (±25% jitter)
Attempt 3 (3rd retry):  500ms  × 2^2 = 2000ms  (±25% jitter)
                                       capped at maxDelayMs
```

For 429 responses with a `Retry-After` header, the delay from the header takes precedence over the calculated exponential delay (still capped at `maxDelayMs`).

Jitter adds ±25% randomization to each delay to prevent synchronized retry storms when multiple clients hit the same error window.

### Configuration

| Parameter | Default | Description |
|-----------|---------|-------------|
| `maxRetries` | 3 | Maximum retry attempts after the initial request |
| `baseDelayMs` | 500 | Starting delay before first retry |
| `maxDelayMs` | 10000 | Maximum delay cap (prevents excessive waits) |
| `backoffMultiplier` | 2 | Multiply delay after each attempt |
| `jitter` | true | ±25% random jitter on each delay |

All configurable via environment variables (`RETRY_MAX_RETRIES`, `RETRY_BASE_DELAY_MS`, `RETRY_MAX_DELAY_MS`).

### Layer Interaction

The retry layer and auth-refresh layer work together but don't interfere:

```
Request flow:
  UpsHttpClient (auth injection + 401 retry)
    └── RetryableHttpClient (5xx/429/timeout retry with backoff)
          └── FetchHttpClient (raw HTTP)

Scenario: 500 → 500 → 200
  RetryableHttpClient handles this — retries twice, third attempt succeeds.
  UpsHttpClient never sees a 401, so it does nothing.

Scenario: 401 (stale token)
  RetryableHttpClient does NOT retry 401 (not in its retry set).
  Returns 401 to UpsHttpClient, which invalidates token, fetches fresh, retries once.

Scenario: 500 → 500 → 401 → (fresh token) → 200
  RetryableHttpClient retries the 500s, eventually returns 401.
  UpsHttpClient catches the 401, refreshes token, retries.
  The retry goes through RetryableHttpClient again (fresh request).
```

---

## Error Handling

All errors extend a structured `CarrierError` base class. No raw strings, no swallowed exceptions, no `catch (e) { console.log(e) }`.

### Error Hierarchy

```
CarrierError (base)
├── carrier: string        // "ups", "fedex", etc.
├── code: string           // Machine-readable error code
├── httpStatus?: number    // HTTP status when applicable
├── cause?: unknown        // Original error for debugging
│
├── AuthenticationError    // 401, 403 — invalid credentials, blocked account
├── ValidationError        // 400 — invalid address, bad request format
├── RateLimitError         // 429 — includes retryAfterMs when available
├── NetworkError           // Connection refused, DNS failure
└── TimeoutError           // Request exceeded configured timeout

AggregateCarrierError      // All carriers failed (wraps CarrierError[])
```

### Three Layers of Error Handling

**Layer 1 — HTTP/Network** (`FetchHttpClient`):
- `AbortController` timeout → `TimeoutError`
- `fetch()` failure → `NetworkError`

**Layer 2 — Carrier API** (`UpsErrorHandler`):
- 401 → `AuthenticationError`
- 403 → `AuthenticationError` ("account may be blocked")
- 400 → `ValidationError` with UPS-specific error code (e.g., `111210` for invalid postal code)
- 429 → `RateLimitError` with parsed `Retry-After` header
- 5xx → `CarrierError` with `server_error` code

**Layer 3 — Orchestration** (`RateShoppingService`):
- If one carrier fails but another succeeds → return partial results
- If ALL carriers fail → throw `AggregateCarrierError` containing all individual errors

### Error Response Examples

```typescript
// Catch specific errors
try {
  const quotes = await rateService.getRates(request);
} catch (error) {
  if (error instanceof RateLimitError) {
    // Wait and retry
    console.log(`Rate limited. Retry after ${error.retryAfterMs}ms`);
  } else if (error instanceof ValidationError) {
    // Fix the request
    console.log(`Validation failed: ${error.message} (code: ${error.code})`);
  } else if (error instanceof AggregateCarrierError) {
    // All carriers failed — inspect individual errors
    for (const e of error.errors) {
      console.log(`${e.carrier}: ${e.message}`);
    }
  }
}
```

---

## Validation Strategy

Validation happens at **every system boundary** using Zod schemas. This catches malformed data early with clear error messages, rather than producing mysterious failures deep in business logic.

| Boundary | What's Validated | Schema |
|----------|-----------------|--------|
| Config loading | Environment variables | `ConfigSchema` |
| Request input | Caller's rate request | `DomainRateRequestSchema` |
| OAuth response | UPS token endpoint response | `UpsTokenResponseSchema` |
| Rate response | UPS rating endpoint response | `UpsRateResponseSchema` |
| Error response | UPS error response structure | `UpsErrorResponseSchema` |

### Input Constraints

```
Address:
  addressLine1  — min 1 char
  city          — min 1 char
  stateProvinceCode — min 1 char
  postalCode    — min 1 char
  countryCode   — exactly 2 chars
  name, addressLine2 — optional

Package:
  weight.value  — positive number
  weight.unit   — "LBS" or "KGS"
  dimensions    — optional; if present, all positive, unit "IN" or "CM"

Request:
  packages      — at least 1
  serviceLevel  — optional enum (Ground, ThreeDay, TwoDay, Express, Overnight)
```

### UPS Response Quirk

The UPS API returns single items as objects and multiple items as arrays (e.g., `RatedShipment` can be `{}` or `[{}, {}]`). This is handled with Zod's `z.union([z.array(schema), schema])` and normalized to arrays in the mapper.

---

## Configuration

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `UPS_CLIENT_ID` | Yes | — | UPS OAuth client ID |
| `UPS_CLIENT_SECRET` | Yes | — | UPS OAuth client secret |
| `UPS_ACCOUNT_NUMBER` | No | — | UPS shipper account number (for account-specific rates) |
| `UPS_ENVIRONMENT` | No | `sandbox` | `sandbox` or `production` |
| `REQUEST_TIMEOUT_MS` | No | `10000` | HTTP request timeout in milliseconds |
| `RETRY_MAX_RETRIES` | No | `3` | Maximum retry attempts for transient failures |
| `RETRY_BASE_DELAY_MS` | No | `500` | Initial retry delay in milliseconds |
| `RETRY_MAX_DELAY_MS` | No | `10000` | Maximum retry delay cap in milliseconds |

See [.env.example](.env.example).

### Config Flow

```
process.env
  → ConfigSchema.parse()     → AppConfig (validated, typed, defaults applied)
    → createUpsConfig()       → UpsConfig { baseUrl, apiVersion, credentials, timeout }
```

**Sandbox vs Production:**
- Sandbox: `https://wwwcie.ups.com` (UPS testing environment)
- Production: `https://onlinetools.ups.com`

---

## Testing

**128 tests** across **13 test files** — all passing.

```bash
pnpm test              # Run all tests
pnpm test:watch        # Watch mode
pnpm test:coverage     # With coverage report
```

### Test Architecture

All tests stub at the HTTP layer using a `MockHttpClient` that records calls and returns preset responses. Fixture files contain realistic UPS API payloads based on the official documentation.

```
MockHttpClient (implements HttpClient)
  ├── Records every request (url, method, headers, body)
  ├── Returns pre-configured responses matching URL patterns
  ├── Supports one-shot responses (onPostOnce) for sequenced scenarios
  └── Throws descriptive errors for unmatched requests
```

### Unit Tests (10 files, 100 tests)

| File | What It Tests |
|------|---------------|
| `config.test.ts` | Env var loading, defaults, required field validation |
| `ups-config.test.ts` | Sandbox/production URL mapping, account number |
| `carrier-factory.test.ts` | Carrier registration, creation, auto-registration |
| `ups-auth.test.ts` | Token lifecycle: caching, expiry margin, concurrent deduplication, 401 refresh, malformed responses |
| `ups-http-client.test.ts` | Bearer token injection, 401 → retry with fresh token, double-401 passthrough, timeout preservation |
| `http-client.test.ts` | FetchHttpClient: AbortController timeout, JSON/text parsing, form encoding, network errors |
| `ups-rate-mapper.test.ts` | Shop vs Rate endpoint selection, address/package mapping, service code lookups, Zod response validation |
| `ups-error-handler.test.ts` | All HTTP status codes (400, 401, 403, 429, 500, 503), Retry-After parsing, malformed error bodies |
| `rate-shopping-service.test.ts` | Multi-carrier fan-out, partial failures, price sorting, AggregateCarrierError on total failure |
| `retry.test.ts` | Exponential backoff timing, max delay cap, jitter, Retry-After respect, non-retryable errors pass through, mixed failure recovery |

### Integration Tests (3 files, 21 tests)

| File | What It Tests |
|------|---------------|
| `ups-rating.test.ts` | Full rate flow end-to-end: request payload construction, response parsing, Shop vs Rate endpoints, 401 retry, 429 rate limiting, 500 errors, malformed responses, addressLine2 mapping, account number inclusion |
| `ups-auth-flow.test.ts` | Full OAuth lifecycle: Basic auth header construction, token reuse across sequential requests, token refresh on expiry, 401 retry with fresh token, Bearer token forwarding |
| `ups-retry.test.ts` | Retry through full UPS stack: 500 recovery on rating endpoint, 500 recovery on OAuth endpoint, exhausted retries producing CarrierError, 400 not retried, 429 with Retry-After |

### Fixture Files

Located in `tests/fixtures/ups/`, these contain realistic UPS API response payloads:

| Fixture | Scenario |
|---------|----------|
| `oauth-token-response.json` | Successful OAuth token with Bearer type, 14399s TTL |
| `rate-shop-response.json` | Multi-service response: Ground ($18.50), 2nd Day Air ($32.75), Next Day Air ($58.99) |
| `rate-single-service-response.json` | Single-service response (Ground only) — tests the object-vs-array handling |
| `rate-error-invalid-address.json` | 400 error: invalid postal code (UPS code 111210) |
| `rate-error-auth-failure.json` | 401 error: invalid credentials (UPS code 250002) |
| `rate-error-rate-limit.json` | 429 error: rate limit exceeded (UPS code 120506) |

---

## Postman Collection

A Postman collection is included at [postman/cybership-ups-api.postman_collection.json](postman/cybership-ups-api.postman_collection.json) for exploring the UPS API endpoints that this service wraps.

### What's Included

1. **OAuth 2.0 Token Request** — client-credentials flow with automatic token extraction
2. **Rate Shop (All Services)** — get quotes for all available UPS services
3. **Rate Specific Service (Ground)** — get a quote for a single service level
4. **Error Scenarios** — invalid address, invalid auth, to demonstrate error response shapes

### Setup

1. Import the collection into Postman
2. Set the collection variables:
   - `ups_client_id` — your UPS OAuth client ID
   - `ups_client_secret` — your UPS OAuth client secret
   - `ups_account_number` — your UPS shipper number (optional)
3. Run the "OAuth Token" request first — it auto-saves the token for subsequent requests
4. Run any rate request

See [postman/README.md](postman/README.md) for detailed instructions.

---

## Extending the Service

### Capability-Based Architecture

Operations are modeled as **opt-in capability interfaces** rather than methods on a monolithic `CarrierProvider`. Each carrier implements only the capabilities it supports:

```typescript
// Base identity — every carrier has this
interface CarrierProvider {
  readonly carrierName: string;
}

// Capabilities — implement only what you support
interface RateCapable {
  rate(request: DomainRateRequest): Promise<NormalizedRateQuote[]>;
}
interface LabelCapable {
  purchaseLabel(request: LabelRequest): Promise<LabelResult>;
}
interface TrackCapable {
  track(trackingNumber: string): Promise<TrackingResult>;
}

// Type guards for runtime capability checking
isRateCapable(provider)   // → provider is CarrierProvider & RateCapable
isLabelCapable(provider)  // → provider is CarrierProvider & LabelCapable
```

**Why this matters:** Adding a `TrackCapable` interface doesn't force UPS or FedEx to stub out `track()` if they don't support it yet. Services like `RateShoppingService` filter providers by capability at runtime using type guards.

### Adding a New Carrier (e.g., FedEx)

**Zero changes to existing code.** Create a new directory mirroring the UPS structure:

```
src/carriers/fedex/
├── index.ts                  # CarrierFactory.register("fedex", ...)
├── fedex-provider.ts         # implements CarrierProvider & RateCapable
├── fedex-config.ts           # FedEx-specific config
├── fedex-auth.ts             # FedEx auth (if different from OAuth 2.0)
├── fedex-http-client.ts      # Auth injection wrapper
├── fedex-rating-operation.ts # Rate endpoint orchestrator
├── fedex-rate-mapper.ts      # Domain ↔ FedEx type translation
├── fedex-error-handler.ts    # FedEx status → structured errors
└── types/                    # FedEx API type definitions
```

1. Implement `CarrierProvider & RateCapable` in `FedexProvider`
2. Self-register in `index.ts` via `CarrierFactory.register("fedex", ...)`
3. Add FedEx env vars to `ConfigSchema` and `.env.example`
4. Import the module to trigger registration

The `RateShoppingService` automatically discovers rate-capable providers via `isRateCapable()`. Existing UPS code is completely untouched.

A carrier that only supports tracking (not rating) simply implements `CarrierProvider & TrackCapable` — it won't be included in rate shopping, and no one needs to know.

### Adding a New Operation (e.g., Label Purchase)

**No existing carrier code needs to change:**

1. Define the capability interface in `carrier-provider.ts`:
   ```typescript
   export interface LabelCapable {
     purchaseLabel(request: LabelRequest): Promise<LabelResult>;
   }
   export function isLabelCapable(p: CarrierProvider): p is CarrierProvider & LabelCapable {
     return "purchaseLabel" in p && typeof (p as any).purchaseLabel === "function";
   }
   ```
2. Define domain types: `LabelRequest`, `LabelResult`
3. Create a `LabelService` (like `RateShoppingService`) that filters with `isLabelCapable()`
4. For UPS specifically:
   - Create `ups-label-operation.ts` and `ups-label-mapper.ts`
   - Add `LabelCapable` to `UpsProvider`: `class UpsProvider implements CarrierProvider, RateCapable, LabelCapable`

The existing `UpsAuthManager`, `UpsHttpClient`, `RetryableHttpClient`, `UpsErrorHandler`, and `UpsConfig` are all reused as-is. Carriers that don't support labels yet (e.g., a future USPS integration) are unaffected — they don't implement `LabelCapable` and are simply filtered out.

---

## Design Decisions

| Decision | Rationale |
|----------|-----------|
| **Zod for validation** | Catches API drift and malformed data at parse time. Dual-purpose: TypeScript types + runtime validation from one schema. |
| **String currency amounts** | `"18.50"` stays exact. `18.5` as a float loses the trailing zero and risks IEEE 754 issues in financial calculations. |
| **`Promise.allSettled` for multi-carrier** | If UPS is down but FedEx works, the caller still gets FedEx quotes. Partial results beat total failure. |
| **Token fetch deduplication** | Concurrent `getAccessToken()` calls share a single in-flight promise. 100 concurrent requests → 1 OAuth call, not 100. |
| **60-second token expiry margin** | UPS tokens last ~4 hours. A request started at T-1s would use a valid-looking token that expires mid-flight. The 60s buffer prevents this. |
| **RetryableHttpClient as decorator** | Retry is a cross-cutting concern — it shouldn't be in carrier code. Wrapping `HttpClient` means any carrier gets retry for free. |
| **Capability interfaces over monolithic provider** | Operations (`RateCapable`, `LabelCapable`, `TrackCapable`) are opt-in interfaces with type guards. Adding a new operation never forces existing carriers to stub out methods they don't support. Services filter by capability at runtime. |
| **Self-registration pattern** | No central switch/if-else for carriers. Adding FedEx = creating a module that registers itself. Supports dynamic configuration. |
| **No DI framework** | Constructor injection is sufficient. The dependency graph is shallow. Adding a DI container would be over-engineering at this scale. |
| **HttpClient interface** | Single seam for test stubbing. All HTTP traffic flows through one injectable interface. Tests never hit the network. |
| **`z.union` for UPS array/object responses** | UPS returns single items as objects and multiple as arrays. This is a documented API quirk that causes subtle bugs if not handled. |
| **Separate UpsHttpClient vs RetryableHttpClient** | Auth-refresh (401 retry) is carrier-specific logic. Transient-failure retry (5xx, timeout) is generic. Keeping them separate means retry works for any carrier, and auth logic stays in UPS code. |

---

## What I Would Improve Given More Time

- **Response caching** — short TTL cache for identical rate requests to reduce API calls under high volume
- **Circuit breaker** — if UPS returns 5xx for N consecutive requests, fail fast for M seconds instead of hammering a down service
- **Structured logging** — request/response logging with pino/winston, sensitive data redaction, correlation IDs for distributed tracing
- **OpenTelemetry instrumentation** — spans for each carrier call, token fetch, retry attempt
- **Additional carriers** — FedEx/USPS implementations to prove the extensibility pattern in practice
- **Additional operations** — label purchase, tracking, address validation (capability interfaces are in place; domain types and carrier-specific implementations are needed)
- **Negotiated rates** — support for UPS negotiated/discounted rates via `NegotiatedRatesIndicator`
- **Request size validation** — cap package count before sending to UPS (API has limits)
- **CLI demo tool** — interactive CLI for quick rate lookups during development
- **Health check endpoint** — verify carrier connectivity before accepting traffic
