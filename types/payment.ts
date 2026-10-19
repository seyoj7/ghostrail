import type { EscrowState } from "./escrow";
import type { RejectionReason } from "./rejection";

/** Result of a payment verification attempt. */
export interface VerifyResult {
  accepted: boolean;
  /** Present only when rejected. */
  reason?: RejectionReason;
  /** Transaction signature, present when accepted. */
  signature?: string;
}

/** Shape of a verify request from the seller to the facilitator. */
export interface VerifyRequest {
  /** Base64-encoded signed transaction from the buyer. */
  transaction: string;
  /** Expected seller public key. */
  seller: string;
  /** Expected payment amount in token base units. */
  amount: string;
  /** Expected token mint. */
  mint: string;
}

/** Shape of a settlement (release / refund) request. */
export interface SettleRequest {
  /** The escrow PDA address. */
  escrowAddress: string;
  /** Whether to release to seller or refund to buyer. */
  action: "release" | "refund";
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
