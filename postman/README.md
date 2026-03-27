# Postman Collection — Cybership UPS Rating API

This Postman collection documents the raw UPS API calls that the Cybership Carrier Integration Service makes under the hood. It serves as both API documentation and a debugging tool.

## What's Included

### Authentication
- **OAuth 2.0 Token** — Client-credentials flow with Basic auth. Test script auto-saves the Bearer token for subsequent requests.

### Rating Endpoints
- **Rate Shop (All Services)** — `POST /api/rating/v2409/Shop` — returns quotes for all available UPS services
- **Rate Specific Service** — `POST /api/rating/v2409/Rate` — returns a quote for UPS Ground only
- **Multiple Packages** — demonstrates multi-package shipment with multi-line addresses
- **Negotiated Rates** — includes `NegotiatedRatesIndicator` for account-specific discounts

### Error Scenarios
- **400 Invalid Address** — postal code `00000` for state `NY`
- **401 Authentication Failure** — invalid Bearer token
- **429 Rate Limit** — includes Retry-After header handling

Each request includes:
- Pre-configured test scripts that validate the response
- Saved example responses showing the exact UPS response shape
- Descriptions explaining how our service maps the request/response

## Setup

### 1. Import the Collection

1. Open Postman
2. Click **Import** (top-left)
3. Drag `cybership-ups-api.postman_collection.json` into the import dialog
4. The collection "Cybership — UPS Rating API" will appear in your sidebar

### 2. Configure Variables

Click on the collection name → **Variables** tab. Set:

| Variable | Required | Description |
|----------|----------|-------------|
| `ups_client_id` | Yes | Your UPS OAuth client ID from [developer.ups.com](https://developer.ups.com) |
| `ups_client_secret` | Yes | Your UPS OAuth client secret |
| `ups_account_number` | No | Your UPS shipper number (for negotiated rates) |
| `base_url` | Pre-set | `https://wwwcie.ups.com` (sandbox) or `https://onlinetools.ups.com` (production) |
| `api_version` | Pre-set | `v2409` |
| `access_token` | Auto-set | Populated automatically by the OAuth request |

### 3. Get a Token

Run **Authentication → OAuth 2.0 Token** first. The test script automatically extracts `access_token` and saves it to collection variables. All subsequent requests use `{{access_token}}` in the Authorization header.

### 4. Run Requests

Run any request in the Rating or Error Scenarios folders. The Bearer token is injected automatically.

## How This Maps to Our Service

| Postman Request | Service Code Path |
|----------------|-------------------|
| OAuth Token | `UpsAuthManager.fetchToken()` |
| Rate Shop | `UpsRatingOperation.execute()` → `/Shop` endpoint |
| Rate Specific | `UpsRatingOperation.execute()` → `/Rate` endpoint |
| 400 Error | `UpsErrorHandler.assertSuccess()` → `ValidationError` |
| 401 Error | `UpsHttpClient.request()` → invalidate + retry |
| 429 Error | `RetryableHttpClient.request()` → backoff + retry |

## Running Without UPS Credentials

If you don't have UPS API credentials, you can still use the collection to understand the API:

1. Each request has **saved example responses** (click the dropdown next to "Send")
2. These examples match the fixture files used in our test suite (`tests/fixtures/ups/`)
3. The request bodies show exactly what our `UpsRateMapper.toUpsRequest()` produces

## Environments

| Environment | Base URL | Notes |
|------------|----------|-------|
| Sandbox | `https://wwwcie.ups.com` | UPS test environment, use for development |
| Production | `https://onlinetools.ups.com` | Live UPS API, real rates |

To switch: change the `base_url` collection variable.
