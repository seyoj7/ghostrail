import type { EscrowState } from "./escrow";
import type { RejectionReason } from "./rejection";

/** Result of a payment verification attempt. */
export interface VerifyResult {
  accepted: boolean;
  /** Present only when rejected. */
  reason?: RejectionReason;
  /** Transaction signature, present when accepted. */
  signature?: string;
  /** Escrow PDA when the lock instruction was valid. */
  escrowAddress?: string;
  /** Verification state; this is not proof of settlement. */
  state?: "Locked" | "Pre-submission";
}

/** Shape of a verify request from the seller to the facilitator. */
export interface VerifyRequest {
  /** Base64-encoded signed transaction from the buyer. */
  transaction: string;
  /**
   * Registered service ID. When provided, seller, amount, and mint are
   * auto-resolved from the service registry.
   */
  serviceId?: string;
  /** Expected seller public key (required when serviceId is not provided). */
  seller?: string;
  /** Expected payment amount in token base units (required when serviceId is not provided). */
  amount?: string;
  /** Expected token mint (required when serviceId is not provided). */
  mint?: string;
}

/** Payment requirements auto-resolved from a registered service. */
export interface ServicePaymentRequirements {
  /** Service registry ID. */
  serviceId: string;
  /** Service name. */
  name: string;
  /** Seller Solana wallet address. */
  seller: string;
  /** Payment amount in token base units. */
  amount: string;
  /** Token mint address. */
  mint: string;
  /** Service endpoint URL. */
  endpointUrl: string;
}

/** Shape of a settlement (release / refund) request. */
export interface SettleRequest {
  /** The escrow PDA address. */
  escrowAddress: string;
  /** Whether to release to seller or refund to buyer. */
  action: "release" | "refund";
  /** Base64 transaction signed by the buyer or seller. */
  transaction: string;
}

/** Payment record stored in the database. */
export interface PaymentRecord {
  id: string;
  signature: string;
  buyer: string;
  seller: string;
  amount: string;
  mint: string;
  escrowState: EscrowState | null;
  accepted: boolean;
  rejectionReason: RejectionReason | null;
  createdAt: Date;
  settledAt: Date | null;
}
