export interface UpsConfig {
  clientId: string;
  clientSecret: string;
  accountNumber?: string;
  baseUrl: string;
  apiVersion: string;
  timeoutMs: number;
}

const BASE_URLS = {
  sandbox: "https://wwwcie.ups.com",
  production: "https://onlinetools.ups.com",
} as const;

const API_VERSION = "v2409";

export function createUpsConfig(env: {
  UPS_CLIENT_ID: string;
  UPS_CLIENT_SECRET: string;
  UPS_ACCOUNT_NUMBER?: string;
  UPS_ENVIRONMENT: "sandbox" | "production";
  REQUEST_TIMEOUT_MS: number;
}): UpsConfig {
  return {
    clientId: env.UPS_CLIENT_ID,
    clientSecret: env.UPS_CLIENT_SECRET,
    accountNumber: env.UPS_ACCOUNT_NUMBER,
    baseUrl: BASE_URLS[env.UPS_ENVIRONMENT],
    apiVersion: API_VERSION,
    timeoutMs: env.REQUEST_TIMEOUT_MS,
  };
}
