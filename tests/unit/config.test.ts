import { describe, it, expect } from "vitest";
import { loadConfig } from "../../src/config.js";

describe("loadConfig", () => {
  const validEnv = {
    UPS_CLIENT_ID: "test-id",
    UPS_CLIENT_SECRET: "test-secret",
    UPS_ACCOUNT_NUMBER: "123456",
    UPS_ENVIRONMENT: "sandbox" as const,
    REQUEST_TIMEOUT_MS: "15000",
  };

  it("loads valid config from env vars", () => {
    const config = loadConfig(validEnv);
    expect(config.UPS_CLIENT_ID).toBe("test-id");
    expect(config.UPS_CLIENT_SECRET).toBe("test-secret");
    expect(config.UPS_ACCOUNT_NUMBER).toBe("123456");
    expect(config.UPS_ENVIRONMENT).toBe("sandbox");
    expect(config.REQUEST_TIMEOUT_MS).toBe(15000);
  });

  it("applies default values for optional fields", () => {
    const config = loadConfig({
      UPS_CLIENT_ID: "test-id",
      UPS_CLIENT_SECRET: "test-secret",
    });
    expect(config.UPS_ENVIRONMENT).toBe("sandbox");
    expect(config.REQUEST_TIMEOUT_MS).toBe(10_000);
    expect(config.UPS_ACCOUNT_NUMBER).toBeUndefined();
    expect(config.RETRY_MAX_RETRIES).toBe(3);
    expect(config.RETRY_BASE_DELAY_MS).toBe(500);
    expect(config.RETRY_MAX_DELAY_MS).toBe(10_000);
  });

  it("parses custom retry config from env vars", () => {
    const config = loadConfig({
      UPS_CLIENT_ID: "test-id",
      UPS_CLIENT_SECRET: "test-secret",
      RETRY_MAX_RETRIES: "5",
      RETRY_BASE_DELAY_MS: "1000",
      RETRY_MAX_DELAY_MS: "30000",
    });
    expect(config.RETRY_MAX_RETRIES).toBe(5);
    expect(config.RETRY_BASE_DELAY_MS).toBe(1000);
    expect(config.RETRY_MAX_DELAY_MS).toBe(30000);
  });

  it("allows RETRY_MAX_RETRIES of 0 (disable retries)", () => {
    const config = loadConfig({
      UPS_CLIENT_ID: "test-id",
      UPS_CLIENT_SECRET: "test-secret",
      RETRY_MAX_RETRIES: "0",
    });
    expect(config.RETRY_MAX_RETRIES).toBe(0);
  });

  it("throws on missing required UPS_CLIENT_ID", () => {
    expect(() => loadConfig({ UPS_CLIENT_SECRET: "secret" })).toThrow();
  });

  it("throws on missing required UPS_CLIENT_SECRET", () => {
    expect(() => loadConfig({ UPS_CLIENT_ID: "id" })).toThrow();
  });

  it("throws on invalid UPS_ENVIRONMENT value", () => {
    expect(() =>
      loadConfig({
        UPS_CLIENT_ID: "id",
        UPS_CLIENT_SECRET: "secret",
        UPS_ENVIRONMENT: "invalid",
      }),
    ).toThrow();
  });
});
