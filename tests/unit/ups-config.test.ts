import { describe, it, expect } from "vitest";
import { createUpsConfig } from "../../src/carriers/ups/ups-config.js";

describe("createUpsConfig", () => {
  it("creates sandbox config from env values", () => {
    const config = createUpsConfig({
      UPS_CLIENT_ID: "my-id",
      UPS_CLIENT_SECRET: "my-secret",
      UPS_ACCOUNT_NUMBER: "ABC123",
      UPS_ENVIRONMENT: "sandbox",
      REQUEST_TIMEOUT_MS: 5000,
    });

    expect(config.clientId).toBe("my-id");
    expect(config.clientSecret).toBe("my-secret");
    expect(config.accountNumber).toBe("ABC123");
    expect(config.baseUrl).toBe("https://wwwcie.ups.com");
    expect(config.apiVersion).toBe("v2409");
    expect(config.timeoutMs).toBe(5000);
  });

  it("creates production config with correct base URL", () => {
    const config = createUpsConfig({
      UPS_CLIENT_ID: "prod-id",
      UPS_CLIENT_SECRET: "prod-secret",
      UPS_ENVIRONMENT: "production",
      REQUEST_TIMEOUT_MS: 10000,
    });

    expect(config.baseUrl).toBe("https://onlinetools.ups.com");
  });

  it("handles missing account number", () => {
    const config = createUpsConfig({
      UPS_CLIENT_ID: "id",
      UPS_CLIENT_SECRET: "secret",
      UPS_ENVIRONMENT: "sandbox",
      REQUEST_TIMEOUT_MS: 10000,
    });

    expect(config.accountNumber).toBeUndefined();
  });
});
