import type { CarrierProvider } from "./carrier-provider.js";
import type { HttpClient } from "../http/http-client.js";

export interface CarrierRegistration {
  create(httpClient: HttpClient, env: Record<string, string | undefined>): CarrierProvider;
}

const registry = new Map<string, CarrierRegistration>();

export const CarrierFactory = {
  register(name: string, registration: CarrierRegistration): void {
    registry.set(name, registration);
  },

  create(name: string, httpClient: HttpClient, env: Record<string, string | undefined> = process.env): CarrierProvider {
    const registration = registry.get(name);
    if (!registration) {
      throw new Error(`Unknown carrier: "${name}". Registered carriers: ${[...registry.keys()].join(", ")}`);
    }
    return registration.create(httpClient, env);
  },

  createAll(httpClient: HttpClient, env: Record<string, string | undefined> = process.env): CarrierProvider[] {
    return [...registry.values()].map((reg) => reg.create(httpClient, env));
  },

  registeredCarriers(): string[] {
    return [...registry.keys()];
  },
};
