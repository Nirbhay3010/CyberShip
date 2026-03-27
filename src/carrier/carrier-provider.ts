import type { DomainRateRequest } from "../domain/rate-request.js";
import type { NormalizedRateQuote } from "../domain/rate-response.js";

/**
 * Base identity for any carrier integration.
 * Capabilities (rate, label, track, etc.) are separate interfaces so that
 * adding a new operation never forces changes on carriers that don't support it.
 */
export interface CarrierProvider {
  readonly carrierName: string;
}

// ── Capability interfaces ───────────────────────────────────────────────

export interface RateCapable {
  rate(request: DomainRateRequest): Promise<NormalizedRateQuote[]>;
}

// Placeholders — implement the domain types when the operation is built:
// export interface LabelCapable {
//   purchaseLabel(request: LabelRequest): Promise<LabelResult>;
// }
// export interface TrackCapable {
//   track(trackingNumber: string): Promise<TrackingResult>;
// }
// export interface AddressValidationCapable {
//   validateAddress(address: Address): Promise<AddressValidationResult>;
// }

// ── Type guards ─────────────────────────────────────────────────────────

export function isRateCapable(provider: CarrierProvider): provider is CarrierProvider & RateCapable {
  return "rate" in provider && typeof (provider as any).rate === "function";
}

// export function isLabelCapable(provider: CarrierProvider): provider is CarrierProvider & LabelCapable {
//   return "purchaseLabel" in provider && typeof (provider as any).purchaseLabel === "function";
// }
// export function isTrackCapable(provider: CarrierProvider): provider is CarrierProvider & TrackCapable {
//   return "track" in provider && typeof (provider as any).track === "function";
// }
