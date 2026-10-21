import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction, TransactionInstruction, sendAndConfirmTransaction } from '@solana/web3.js';
import { getOrCreateAssociatedTokenAccount, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import bs58 from 'bs58';

function loadDotEnv() {
  try {
    const contents = readFileSync(resolve(process.cwd(), '.env'), 'utf8');
    for (const line of contents.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!match || process.env[match[1]]) continue;
      process.env[match[1]] = match[2].replace(/^[']|[']$/g, '');
    }
  } catch {
    // The required() checks below provide the useful error when .env is absent.
  }
}

loadDotEnv();

const RPC_URL = process.env.SOLANA_RPC_URL;
const PROGRAM_ID = process.env.ESCROW_PROGRAM_ID;
const MINT_ADDRESS = process.env.USDC_MINT;
const FACILITATOR_URL = process.env.FACILITATOR_URL ?? 'http://localhost:3000';
const SELLER_ADDRESS = process.env.SELLER_WALLET ?? process.argv[2];
const PRICE_USDC = process.env.PAYMENT_AMOUNT_USDC ?? process.argv[3] ?? '0.01';
const BUYER_PRIVATE_KEY = process.env.BUYER_PRIVATE_KEY;
const USDC_DECIMALS = 6;
const LOCK_DISCRIMINATOR = Buffer.from([21, 19, 208, 43, 237, 62, 255, 87]);

function required(name, value) {
  if (!value) throw new Error(name + ' is missing from .env or the command line');
  return value;
}

function parseAmount(value) {
  if (!/^(?:0|[1-9][0-9]*)(?:[.][0-9]{1,6})?$/.test(value)) {
    throw new Error('Payment amount must be a positive USDC value with up to 6 decimals');
  }
  const [whole, fraction = ''] = value.split('.');
  const amount = BigInt(whole) * 10n ** BigInt(USDC_DECIMALS) + BigInt(fraction.padEnd(USDC_DECIMALS, '0'));
  if (amount <= 0n) throw new Error('Payment amount must be greater than zero');
  return amount;
}

function loadBuyer() {
  return requireEnv('BUYER_PRIVATE_KEY', BUYER_PRIVATE_KEY);
}

function requireEnv(name, value) {
  if (!value) throw new Error(name + ' is missing from .env');
  try {
    return bs58.decode(value);
  } catch {
    throw new Error(name + ' must be a valid base58 private key');
  }
}

function derivePdas(programId, buyer, escrowId) {
  const escrowIdBytes = Buffer.alloc(8);
  escrowIdBytes.writeBigUInt64LE(escrowId);
  const [escrow] = PublicKey.findProgramAddressSync(
    [Buffer.from('escrow'), buyer.toBuffer(), escrowIdBytes],
    programId
  );
  const [vault] = PublicKey.findProgramAddressSync(
    [Buffer.from('vault'), escrow.toBuffer()],
    programId
  );
  return { escrow, vault, escrowIdBytes };
}

async function main() {
  required('SOLANA_RPC_URL', RPC_URL);
  required('ESCROW_PROGRAM_ID', PROGRAM_ID);
  required('USDC_MINT', MINT_ADDRESS);
  required('SELLER_WALLET', SELLER_ADDRESS);
  const buyer = Keypair.fromSecretKey(loadBuyer());
  const connection = new Connection(RPC_URL, 'confirmed');
  const programId = new PublicKey(PROGRAM_ID);
  const mint = new PublicKey(MINT_ADDRESS);
  const seller = new PublicKey(SELLER_ADDRESS);
  const amount = parseAmount(PRICE_USDC);
  const solBalance = await connection.getBalance(buyer.publicKey, 'confirmed');
  if (solBalance < 0.01 * LAMPORTS_PER_SOL) {
    throw new Error('Buyer wallet needs at least 0.01 devnet SOL for account rent and transaction fees');
  }
  const escrowId = randomBytes(8).readBigUInt64LE(0);
  const timeout = BigInt(Math.floor(Date.now() / 1000) + 300);
  const { escrow, vault } = derivePdas(programId, buyer.publicKey, escrowId);
  const buyerToken = await getOrCreateAssociatedTokenAccount(
    connection,
    buyer,
    mint,
    buyer.publicKey
  );
  if (BigInt(buyerToken.amount) < amount) {
    throw new Error('Buyer wallet does not have enough devnet USDC for this payment');
  }

  const data = Buffer.alloc(32);
  LOCK_DISCRIMINATOR.copy(data, 0);
  data.writeBigUInt64LE(escrowId, 8);
  data.writeBigUInt64LE(amount, 16);
  data.writeBigInt64LE(timeout, 24);

  const lockInstruction = new TransactionInstruction({
    programId,
    data,
    keys: [
      { pubkey: buyer.publicKey, isSigner: true, isWritable: false },
      { pubkey: buyer.publicKey, isSigner: true, isWritable: true },
      { pubkey: seller, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: escrow, isSigner: false, isWritable: true },
      { pubkey: buyerToken.address, isSigner: false, isWritable: true },
      { pubkey: vault, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
  });

  const transaction = new Transaction().add(lockInstruction);
  transaction.feePayer = buyer.publicKey;
  transaction.recentBlockhash = (await connection.getLatestBlockhash('confirmed')).blockhash;
  transaction.sign(buyer);

  const signature = await sendAndConfirmTransaction(connection, transaction, [buyer], {
    commitment: 'confirmed',
  });
  const serialized = transaction.serialize().toString('base64');

  const verificationResponse = await fetch(FACILITATOR_URL + '/api', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      transaction: serialized,
      seller: seller.toBase58(),
      amount: amount.toString(),
      mint: mint.toBase58(),
    }),
  });
  const verification = await verificationResponse.json();
  console.log('On-chain payment submitted.');
  console.log('Transaction:', signature);
  console.log('Escrow:', escrow.toBase58());
  console.log('Verification:', JSON.stringify(verification));

  if (!verificationResponse.ok || verification.accepted !== true) {
    throw new Error('Payment reached the chain but facilitator verification failed');
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
