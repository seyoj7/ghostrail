import "server-only";

import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";

// ── JSON file-based database ────────────────────────────────────────
// Stores seen signatures (replay protection) and payment records.
// Good enough for devnet — swap for a real DB in production.

const DB_PATH = join(process.cwd(), "data", "db.json");

interface PaymentRecordRow {
  id: string;
  signature: string;
  buyer: string;
  seller: string;
  amount: string;
  mint: string;
  escrowAddress: string | null;
  escrowState: string | null;
  accepted: boolean;
  rejectionReason: string | null;
  createdAt: string;
  settledAt: string | null;
}

interface Database {
  seenSignatures: Record<string, string>; // signature → ISO timestamp
  paymentRecords: PaymentRecordRow[];
}

function loadDb(): Database {
  if (!existsSync(DB_PATH)) {
    return { seenSignatures: {}, paymentRecords: [] };
  }
  try {
    return JSON.parse(readFileSync(DB_PATH, "utf-8"));
  } catch {
    return { seenSignatures: {}, paymentRecords: [] };
  }
}

function saveDb(db: Database): void {
  // Ensure the data/ directory exists
  const dir = join(process.cwd(), "data");
  if (!existsSync(dir)) {
    const { mkdirSync } = require("fs");
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(DB_PATH, JSON.stringify(db, null, 2), "utf-8");
}

// ── Public API (mirrors what Prisma was doing) ──────────────────────

/** Check if a signature has already been accepted. */
export function hasSignature(signature: string): boolean {
  const db = loadDb();
  return signature in db.seenSignatures;
}

/** Mark a signature as seen (replay protection). */
export function addSignature(signature: string): void {
  const db = loadDb();
  db.seenSignatures[signature] = new Date().toISOString();
  saveDb(db);
}

/** Insert a payment record. */
export function addPaymentRecord(record: Omit<PaymentRecordRow, "id" | "createdAt" | "settledAt">): void {
  const db = loadDb();
  db.paymentRecords.push({
    ...record,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    settledAt: null,
  });
  saveDb(db);
}

/** Find a payment record by signature. */
export function findPaymentBySignature(signature: string): PaymentRecordRow | undefined {
  const db = loadDb();
  return db.paymentRecords
    .filter((r) => r.signature === signature)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
}

/** Update payment records matching an escrow address. */
export function updatePaymentByEscrow(
  escrowAddress: string,
  update: { escrowState?: string; settledAt?: string }
): void {
  const db = loadDb();
  for (const record of db.paymentRecords) {
    if (record.escrowAddress === escrowAddress) {
      if (update.escrowState) record.escrowState = update.escrowState;
      if (update.settledAt) record.settledAt = update.settledAt;
    }
  }
  saveDb(db);
}

/** Get recent payment records. */
export function getRecentPayments(limit = 50): PaymentRecordRow[] {
  const db = loadDb();
  return db.paymentRecords
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit);
}
