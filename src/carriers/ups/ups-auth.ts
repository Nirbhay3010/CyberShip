import { AuthenticationError, CarrierError } from "../../domain/errors.js";
import type { HttpClient } from "../../http/http-client.js";
import { UpsTokenResponseSchema } from "./types/auth.js";
import type { UpsConfig } from "./ups-config.js";

const TOKEN_EXPIRY_MARGIN_MS = 60_000;

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

export class UpsAuthManager {
  private cachedToken: CachedToken | null = null;
  private pendingFetch: Promise<string> | null = null;

  constructor(
    private readonly httpClient: HttpClient,
    private readonly config: UpsConfig,
  ) {}

  async getAccessToken(): Promise<string> {
    if (this.cachedToken && !this.isTokenExpired()) {
      return this.cachedToken.accessToken;
    }

    // Deduplicate concurrent token fetches — if a fetch is already in-flight,
    // all callers share the same promise instead of issuing parallel requests.
    if (this.pendingFetch) {
      return this.pendingFetch;
    }

    this.pendingFetch = this.fetchAndCache();
    try {
      return await this.pendingFetch;
    } finally {
      this.pendingFetch = null;
    }
  }

  private async fetchAndCache(): Promise<string> {
    const tokenResponse = await this.fetchToken();

    this.cachedToken = {
      accessToken: tokenResponse.access_token,
      expiresAt: Date.now() + tokenResponse.expires_in * 1000 - TOKEN_EXPIRY_MARGIN_MS,
    };

    return this.cachedToken.accessToken;
  }

  invalidateToken(): void {
    this.cachedToken = null;
  }

  private isTokenExpired(): boolean {
    if (!this.cachedToken) return true;
    return Date.now() >= this.cachedToken.expiresAt;
  }

  private async fetchToken() {
    const credentials = Buffer.from(
      `${this.config.clientId}:${this.config.clientSecret}`,
    ).toString("base64");

    const response = await this.httpClient.request({
      url: `${this.config.baseUrl}/security/v1/oauth/token`,
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
      },
      body: { grant_type: "client_credentials" },
      formEncoded: true,
      timeoutMs: this.config.timeoutMs,
    });

    if (response.status !== 200) {
      throw new AuthenticationError(
        "ups",
        `OAuth token request failed with status ${response.status}`,
        response.status,
        response.data,
      );
    }

    const parsed = UpsTokenResponseSchema.safeParse(response.data);
    if (!parsed.success) {
      throw new CarrierError(
        `Malformed OAuth token response: ${parsed.error.message}`,
        "ups",
        "malformed_response",
        response.status,
        parsed.error,
      );
    }

    return parsed.data;
  }
}
