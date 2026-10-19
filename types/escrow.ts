/** Escrow states matching the on-chain Rust enum. */
export enum EscrowState {
  Locked = "Locked",
  Released = "Released",
  Refunded = "Refunded",
}

/** Shape of the on-chain escrow account once deserialized. */
export interface EscrowAccount {
  buyer: string;
  seller: string;
  mint: string;
  amount: bigint;
  timeout: bigint;
  escrowId: bigint;
  state: EscrowState;
  bump: number;
}

/** Parameters for creating a new escrow lock. */
export interface LockParams {
  escrowId: bigint;
  amount: bigint;
  timeout: number;
  buyer: string;
  seller: string;
  mint: string;
}
