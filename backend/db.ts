import 'server-only';

import { Pool, type PoolClient } from 'pg';

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error('DATABASE_URL is required');
}

const globalForDb = globalThis as unknown as {
  pool: Pool | undefined;
  databaseReady: Promise<void> | undefined;
};

export const pool =
  globalForDb.pool ??
  new Pool({
    connectionString: databaseUrl,
  });

if (process.env.NODE_ENV !== 'production') {
  globalForDb.pool = pool;
}

const schemaSql = `
CREATE TABLE IF NOT EXISTS seen_signatures (
  signature VARCHAR(128) PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payment_records (
  id UUID PRIMARY KEY,
  signature VARCHAR(128) NOT NULL,
  buyer VARCHAR(64) NOT NULL,
  seller VARCHAR(64) NOT NULL,
  amount VARCHAR(78) NOT NULL,
  mint VARCHAR(64) NOT NULL,
  escrow_address VARCHAR(64),
  escrow_state VARCHAR(32),
  accepted BOOLEAN NOT NULL,
  rejection_reason VARCHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  settled_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS payment_records_signature_idx
  ON payment_records (signature);
CREATE INDEX IF NOT EXISTS payment_records_escrow_address_idx
  ON payment_records (escrow_address);
CREATE INDEX IF NOT EXISTS payment_records_created_at_idx
  ON payment_records (created_at DESC);

CREATE TABLE IF NOT EXISTS registered_services (
  id UUID PRIMARY KEY,
  name VARCHAR(80) NOT NULL,
  endpoint_url VARCHAR(2048) NOT NULL,
  seller_wallet VARCHAR(64) NOT NULL,
  price_usdc VARCHAR(80) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS registered_services_created_at_idx
  ON registered_services (created_at DESC);
`;

async function ensureDatabase(): Promise<void> {
  globalForDb.databaseReady ??= (async () => {
    await pool.query(schemaSql);
  })();

  await globalForDb.databaseReady;
}

export interface PaymentRecordRow {
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

interface PaymentRecordDbRow {
  id: string;
  signature: string;
  buyer: string;
  seller: string;
  amount: string;
  mint: string;
  escrow_address: string | null;
  escrow_state: string | null;
  accepted: boolean;
  rejection_reason: string | null;
  created_at: Date | string;
  settled_at: Date | string | null;
}

export interface RegisteredService {
  id: string;
  name: string;
  endpointUrl: string;
  sellerWallet: string;
  priceUsdc: string;
  createdAt: string;
}

interface RegisteredServiceDbRow {
  id: string;
  name: string;
  endpoint_url: string;
  seller_wallet: string;
  price_usdc: string;
  created_at: Date | string;
}

type PaymentRecordInput = Omit<
  PaymentRecordRow,
  'id' | 'createdAt' | 'settledAt'
>;

function toIso(value: Date | string | null): string | null {
  return value === null ? null : new Date(value).toISOString();
}

function mapPaymentRecord(row: PaymentRecordDbRow): PaymentRecordRow {
  return {
    id: row.id,
    signature: row.signature,
    buyer: row.buyer,
    seller: row.seller,
    amount: row.amount,
    mint: row.mint,
    escrowAddress: row.escrow_address,
    escrowState: row.escrow_state,
    accepted: row.accepted,
    rejectionReason: row.rejection_reason,
    createdAt: toIso(row.created_at) as string,
    settledAt: toIso(row.settled_at),
  };
}

function mapRegisteredService(row: RegisteredServiceDbRow): RegisteredService {
  return {
    id: row.id,
    name: row.name,
    endpointUrl: row.endpoint_url,
    sellerWallet: row.seller_wallet,
    priceUsdc: row.price_usdc,
    createdAt: toIso(row.created_at) as string,
  };
}

async function insertPaymentRecord(
  client: PoolClient,
  record: PaymentRecordInput
): Promise<void> {
  await client.query(
    'INSERT INTO payment_records (id, signature, buyer, seller, amount, mint, escrow_address, escrow_state, accepted, rejection_reason) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)',
    [
      crypto.randomUUID(),
      record.signature,
      record.buyer,
      record.seller,
      record.amount,
      record.mint,
      record.escrowAddress,
      record.escrowState,
      record.accepted,
      record.rejectionReason,
    ]
  );
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === '23505'
  );
}

/** Atomically claim a signature and store its accepted payment record. */
export async function recordAcceptedPayment(
  record: PaymentRecordInput
): Promise<boolean> {
  await ensureDatabase();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query(
      'INSERT INTO seen_signatures (signature) VALUES ($1)',
      [record.signature]
    );
    await insertPaymentRecord(client, record);
    await client.query('COMMIT');
    return true;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    if (isUniqueViolation(error)) {
      return false;
    }
    throw error;
  } finally {
    client.release();
  }
}

/** Insert a payment record, including rejected attempts. */
export async function addPaymentRecord(
  record: PaymentRecordInput
): Promise<void> {
  await ensureDatabase();
  await pool.query(
    'INSERT INTO payment_records (id, signature, buyer, seller, amount, mint, escrow_address, escrow_state, accepted, rejection_reason) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)',
    [
      crypto.randomUUID(),
      record.signature,
      record.buyer,
      record.seller,
      record.amount,
      record.mint,
      record.escrowAddress,
      record.escrowState,
      record.accepted,
      record.rejectionReason,
    ]
  );
}

/** Find the newest payment record by signature. */
export async function findPaymentBySignature(
  signature: string
): Promise<PaymentRecordRow | undefined> {
  await ensureDatabase();
  const result = await pool.query<PaymentRecordDbRow>(
    'SELECT id, signature, buyer, seller, amount, mint, escrow_address, escrow_state, accepted, rejection_reason, created_at, settled_at FROM payment_records WHERE signature = $1 ORDER BY created_at DESC LIMIT 1',
    [signature]
  );
  const row = result.rows[0];
  return row ? mapPaymentRecord(row) : undefined;
}

/** Update payment records matching an escrow address. */
export async function updatePaymentByEscrow(
  escrowAddress: string,
  update: { escrowState?: string; settledAt?: string }
): Promise<void> {
  await ensureDatabase();
  const assignments: string[] = [];
  const values: unknown[] = [];

  if (update.escrowState !== undefined) {
    values.push(update.escrowState);
    assignments.push('escrow_state = $' + values.length);
  }

  if (update.settledAt !== undefined) {
    values.push(update.settledAt);
    assignments.push('settled_at = $' + values.length);
  }

  if (assignments.length === 0) {
    return;
  }

  values.push(escrowAddress);
  await pool.query(
    'UPDATE payment_records SET ' +
    assignments.join(', ') +
    ' WHERE escrow_address = $' +
    values.length,
    values
  );
}

/** Get recent payment records. */
export async function getRecentPayments(
  limit = 50
): Promise<PaymentRecordRow[]> {
  await ensureDatabase();
  const result = await pool.query<PaymentRecordDbRow>(
    'SELECT id, signature, buyer, seller, amount, mint, escrow_address, escrow_state, accepted, rejection_reason, created_at, settled_at FROM payment_records ORDER BY created_at DESC LIMIT $1',
    [limit]
  );
  return result.rows.map(mapPaymentRecord);
}

/** Register a seller's public service endpoint. */
export async function addRegisteredService(
  service: Omit<RegisteredService, 'id' | 'createdAt'>
): Promise<RegisteredService> {
  await ensureDatabase();
  const result = await pool.query<RegisteredServiceDbRow>(
    'INSERT INTO registered_services (id, name, endpoint_url, seller_wallet, price_usdc) VALUES ($1, $2, $3, $4, $5) RETURNING id, name, endpoint_url, seller_wallet, price_usdc, created_at',
    [
      crypto.randomUUID(),
      service.name,
      service.endpointUrl,
      service.sellerWallet,
      service.priceUsdc,
    ]
  );
  return mapRegisteredService(result.rows[0]);
}

/** List seller service registrations. */
export async function getRegisteredServices(): Promise<RegisteredService[]> {
  await ensureDatabase();
  const result = await pool.query<RegisteredServiceDbRow>(
    'SELECT id, name, endpoint_url, seller_wallet, price_usdc, created_at FROM registered_services ORDER BY created_at DESC'
  );
  return result.rows.map(mapRegisteredService);
}
