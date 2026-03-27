import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, "..", "fixtures", "ups");

export function loadFixture<T = unknown>(name: string): T {
  const raw = readFileSync(join(fixturesDir, name), "utf-8");
  return JSON.parse(raw) as T;
}

export const fixtures = {
  oauthToken: () => loadFixture("oauth-token-response.json"),
  rateShopResponse: () => loadFixture("rate-shop-response.json"),
  rateSingleServiceResponse: () => loadFixture("rate-single-service-response.json"),
  rateErrorInvalidAddress: () => loadFixture("rate-error-invalid-address.json"),
  rateErrorAuthFailure: () => loadFixture("rate-error-auth-failure.json"),
  rateErrorRateLimit: () => loadFixture("rate-error-rate-limit.json"),
};

export function sampleRateRequest() {
  return {
    origin: {
      name: "Test Shipper",
      addressLine1: "123 Main St",
      city: "New York",
      stateProvinceCode: "NY",
      postalCode: "10001",
      countryCode: "US",
    },
    destination: {
      name: "Test Recipient",
      addressLine1: "456 Oak Ave",
      city: "Los Angeles",
      stateProvinceCode: "CA",
      postalCode: "90001",
      countryCode: "US",
    },
    packages: [
      {
        weight: { value: 5.5, unit: "LBS" as const },
        dimensions: {
          length: 10,
          width: 8,
          height: 6,
          unit: "IN" as const,
        },
      },
    ],
  };
}
