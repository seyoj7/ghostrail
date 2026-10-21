export async function register(): Promise<void> {
  if (
    process.env.NEXT_RUNTIME !== "nodejs" ||
    process.env.NEXT_PHASE === "phase-production-build" ||
    process.env.AUTO_REFUND_ENABLED !== "true"
  ) {
    return;
  }

  const required = ["DATABASE_URL", "SOLANA_RPC_URL", "ESCROW_PROGRAM_ID", "FACILITATOR_PRIVATE_KEY", "BUYER_PRIVATE_KEY"];
  const missing = required.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    console.error(`Automatic refunds disabled; missing: ${missing.join(", ")}`);
    return;
  }

  const { startAutomaticRefundWorker } = await import("./backend/refund-worker");
  startAutomaticRefundWorker();
}
