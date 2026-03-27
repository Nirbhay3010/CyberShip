import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { FetchHttpClient } from "../../src/http/http-client.js";
import { TimeoutError, NetworkError } from "../../src/domain/errors.js";

describe("FetchHttpClient", () => {
  let client: FetchHttpClient;

  beforeEach(() => {
    client = new FetchHttpClient();
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("throws TimeoutError when request exceeds timeoutMs", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation((_url, init) => {
      return new Promise((_resolve, reject) => {
        // Listen for abort and reject like a real fetch would
        init?.signal?.addEventListener("abort", () => {
          const err = new DOMException("The operation was aborted.", "AbortError");
          reject(err);
        });
      });
    });

    await expect(
      client.request({ url: "https://api.example.com/test", method: "GET", timeoutMs: 1 }),
    ).rejects.toThrow(TimeoutError);

    try {
      await client.request({ url: "https://api.example.com/test", method: "GET", timeoutMs: 1 });
    } catch (err) {
      expect((err as TimeoutError).message).toContain("timed out");
    }
  });

  it("throws NetworkError on connection failure", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));

    await expect(
      client.request({ url: "https://api.example.com/test", method: "GET" }),
    ).rejects.toThrow(NetworkError);

    try {
      await client.request({ url: "https://api.example.com/test", method: "GET" });
    } catch (err) {
      expect((err as NetworkError).message).toContain("fetch failed");
      expect((err as NetworkError).cause).toBeInstanceOf(TypeError);
    }
  });

  it("parses JSON response when content-type is application/json", async () => {
    const fetchMock = vi.mocked(fetch);
    const mockHeaders = new Headers({ "content-type": "application/json" });
    fetchMock.mockResolvedValue({
      status: 200,
      headers: mockHeaders,
      json: async () => ({ result: "ok" }),
      text: async () => '{"result":"ok"}',
    } as Response);

    const response = await client.request({ url: "https://api.example.com/test", method: "GET" });

    expect(response.status).toBe(200);
    expect(response.data).toEqual({ result: "ok" });
  });

  it("returns text response when content-type is not JSON", async () => {
    const fetchMock = vi.mocked(fetch);
    const mockHeaders = new Headers({ "content-type": "text/plain" });
    fetchMock.mockResolvedValue({
      status: 200,
      headers: mockHeaders,
      json: async () => ({}),
      text: async () => "plain text response",
    } as Response);

    const response = await client.request({ url: "https://api.example.com/test", method: "GET" });

    expect(response.data).toBe("plain text response");
  });

  it("sends form-encoded body when formEncoded is true", async () => {
    const fetchMock = vi.mocked(fetch);
    const mockHeaders = new Headers({ "content-type": "application/json" });
    fetchMock.mockResolvedValue({
      status: 200,
      headers: mockHeaders,
      json: async () => ({ ok: true }),
      text: async () => "{}",
    } as Response);

    await client.request({
      url: "https://api.example.com/test",
      method: "POST",
      body: { grant_type: "client_credentials" },
      formEncoded: true,
    });

    const [, fetchInit] = fetchMock.mock.calls[0];
    expect(fetchInit?.body).toBe("grant_type=client_credentials");
    expect((fetchInit?.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/x-www-form-urlencoded",
    );
  });

  it("sends JSON body by default", async () => {
    const fetchMock = vi.mocked(fetch);
    const mockHeaders = new Headers({ "content-type": "application/json" });
    fetchMock.mockResolvedValue({
      status: 200,
      headers: mockHeaders,
      json: async () => ({ ok: true }),
      text: async () => "{}",
    } as Response);

    await client.request({
      url: "https://api.example.com/test",
      method: "POST",
      body: { key: "value" },
    });

    const [, fetchInit] = fetchMock.mock.calls[0];
    expect(fetchInit?.body).toBe('{"key":"value"}');
    expect((fetchInit?.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
  });

  it("uses custom carrier name in timeout errors", async () => {
    const upsClient = new FetchHttpClient("ups");
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation((_url, init) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("The operation was aborted.", "AbortError"));
        });
      });
    });

    try {
      await upsClient.request({ url: "https://api.example.com/test", method: "GET", timeoutMs: 1 });
    } catch (err) {
      expect((err as TimeoutError).carrier).toBe("ups");
    }
  });

  it("uses custom carrier name in network errors", async () => {
    const upsClient = new FetchHttpClient("ups");
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));

    try {
      await upsClient.request({ url: "https://api.example.com/test", method: "GET" });
    } catch (err) {
      expect((err as NetworkError).carrier).toBe("ups");
    }
  });

  it("defaults carrier name to unknown", async () => {
    const defaultClient = new FetchHttpClient();
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));

    try {
      await defaultClient.request({ url: "https://api.example.com/test", method: "GET" });
    } catch (err) {
      expect((err as NetworkError).carrier).toBe("unknown");
    }
  });

  it("clears timeout on successful response", async () => {
    const clearTimeoutSpy = vi.spyOn(global, "clearTimeout");
    const fetchMock = vi.mocked(fetch);
    const mockHeaders = new Headers({ "content-type": "application/json" });
    fetchMock.mockResolvedValue({
      status: 200,
      headers: mockHeaders,
      json: async () => ({ ok: true }),
      text: async () => "{}",
    } as Response);

    await client.request({
      url: "https://api.example.com/test",
      method: "GET",
      timeoutMs: 5000,
    });

    expect(clearTimeoutSpy).toHaveBeenCalled();
  });
});
