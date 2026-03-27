import type { HttpClient, HttpRequestConfig, HttpResponse } from "../../src/http/http-client.js";

interface MockResponse {
  urlPattern: string;
  method?: string;
  response: HttpResponse;
  once?: boolean;
}

export class MockHttpClient implements HttpClient {
  private mocks: MockResponse[] = [];
  private _calls: HttpRequestConfig[] = [];

  get calls(): HttpRequestConfig[] {
    return this._calls;
  }

  onPost(urlPattern: string, response: HttpResponse): this {
    this.mocks.push({ urlPattern, method: "POST", response });
    return this;
  }

  onGet(urlPattern: string, response: HttpResponse): this {
    this.mocks.push({ urlPattern, method: "GET", response });
    return this;
  }

  onAny(urlPattern: string, response: HttpResponse): this {
    this.mocks.push({ urlPattern, response });
    return this;
  }

  onPostOnce(urlPattern: string, response: HttpResponse): this {
    this.mocks.push({ urlPattern, method: "POST", response, once: true });
    return this;
  }

  reset(): void {
    this.mocks = [];
    this._calls = [];
  }

  async request<T = unknown>(config: HttpRequestConfig): Promise<HttpResponse<T>> {
    this._calls.push(config);

    const matchIndex = this.mocks.findIndex(
      (mock) =>
        config.url.includes(mock.urlPattern) &&
        (!mock.method || mock.method === config.method),
    );

    if (matchIndex === -1) {
      throw new Error(
        `MockHttpClient: No mock registered for ${config.method} ${config.url}. ` +
          `Registered mocks: ${this.mocks.map((m) => `${m.method ?? "ANY"} ${m.urlPattern}`).join(", ")}`,
      );
    }

    const mock = this.mocks[matchIndex];
    if (mock.once) {
      this.mocks.splice(matchIndex, 1);
    }

    return mock.response as HttpResponse<T>;
  }
}

export function makeResponse<T>(status: number, data: T, headers: Record<string, string> = {}): HttpResponse<T> {
  return { status, data, headers };
}
