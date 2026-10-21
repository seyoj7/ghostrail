import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js';
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
    // Required-value checks below provide the useful error when .env is absent.
  }
}

loadDotEnv();

const ACTION = process.argv[2];
const ESCROW_ADDRESS = process.argv[3];
const RPC_URL = process.env.SOLANA_RPC_URL;
const PROGRAM_ID = process.env.ESCROW_PROGRAM_ID;
const USDC_MINT = process.env.USDC_MINT;
const FACILITATOR_URL = process.env.FACILITATOR_URL ?? 'http://localhost:3000';
const FACILITATOR_PUBLIC_KEY = process.env.FACILITATOR_PUBLIC_KEY;
const FACILITATOR_PRIVATE_KEY = process.env.FACILITATOR_PRIVATE_KEY;
const BUYER_PRIVATE_KEY = process.env.BUYER_PRIVATE_KEY;
const SELLER_PRIVATE_KEY = process.env.SELLER_PRIVATE_KEY;

const ESCROW_ACCOUNT_DISCRIMINATOR = Buffer.from([
  31, 213, 123, 187, 186, 22, 218, 155,
]);
const RELEASE_DISCRIMINATOR = Buffer.from([
  253, 249, 15, 206, 28, 127, 193, 241,
]);
const REFUND_DISCRIMINATOR = Buffer.from([
  2, 96, 183, 251, 63, 208, 46, 46,
]);

function required(name, value) {
  if (!value) throw new Error(`${name} is missing from .env or the command line`);
  return value;
}

function loadKeypair(name, value) {
  required(name, value);
  try {
    return Keypair.fromSecretKey(bs58.decode(value));
  } catch {
    throw new Error(`${name} must be a valid base58 private key`);
  }
}

function loadFacilitatorPublicKey() {
  if (FACILITATOR_PUBLIC_KEY) {
    try {
      return new PublicKey(FACILITATOR_PUBLIC_KEY);
    } catch {
      throw new Error('FACILITATOR_PUBLIC_KEY must be a valid public key');
    }
  }

  return loadKeypair('FACILITATOR_PRIVATE_KEY', FACILITATOR_PRIVATE_KEY).publicKey;
}

function parseEscrow(accountInfo, escrowAddress, programId) {
  if (!accountInfo || !accountInfo.owner.equals(programId) || accountInfo.data.length < 130) {
    throw new Error(`Escrow account was not found at ${escrowAddress}`);
  }

  const data = accountInfo.data;
  if (!data.subarray(0, 8).equals(ESCROW_ACCOUNT_DISCRIMINATOR)) {
    throw new Error('The address is not a GHOSTRAIL escrow account');
  }

  return {
    buyer: new PublicKey(data.subarray(8, 40)),
    seller: new PublicKey(data.subarray(40, 72)),
    mint: new PublicKey(data.subarray(72, 104)),
    timeout: data.readBigInt64LE(112),
    state: data[128],
  };
}

async function main() {
  if (ACTION !== 'release' && ACTION !== 'refund') {
    throw new Error('Usage: node scripts/settle-demo-payment.mjs <release|refund> <ESCROW_ADDRESS>');
  }
  required('SOLANA_RPC_URL', RPC_URL);
  required('ESCROW_PROGRAM_ID', PROGRAM_ID);
  required('USDC_MINT', USDC_MINT);
  required('ESCROW_ADDRESS', ESCROW_ADDRESS);

  const connection = new Connection(RPC_URL, 'confirmed');
  const programId = new PublicKey(PROGRAM_ID);
  const expectedMint = new PublicKey(USDC_MINT);
  const escrowAddress = new PublicKey(ESCROW_ADDRESS);
  const accountInfo = await connection.getAccountInfo(escrowAddress, 'confirmed');
  const escrow = parseEscrow(accountInfo, escrowAddress.toBase58(), programId);

  if (escrow.state !== 0) {
    throw new Error('Escrow is not Locked; it may already be released or refunded');
  }
  if (!escrow.mint.equals(expectedMint)) {
    throw new Error('Escrow mint does not match USDC_MINT');
  }

  const now = BigInt(Math.floor(Date.now() / 1000));
  if (ACTION === 'refund' && now < escrow.timeout) {
    throw new Error(`Refund is not available for ${escrow.timeout - now} more seconds`);
  }

  let authority;
  if (ACTION === 'refund') {
    authority = loadKeypair('BUYER_PRIVATE_KEY', BUYER_PRIVATE_KEY);
    if (!authority.publicKey.equals(escrow.buyer)) {
      throw new Error('BUYER_PRIVATE_KEY does not match the escrow buyer');
    }
  } else if (SELLER_PRIVATE_KEY) {
    authority = loadKeypair('SELLER_PRIVATE_KEY', SELLER_PRIVATE_KEY);
  } else if (escrow.seller.equals(escrow.buyer)) {
    authority = loadKeypair('BUYER_PRIVATE_KEY', BUYER_PRIVATE_KEY);
  } else {
    throw new Error('SELLER_PRIVATE_KEY is required to release to a different seller');
  }

  const expectedAuthority = ACTION === 'release' ? escrow.seller : escrow.buyer;
  if (!authority.publicKey.equals(expectedAuthority)) {
    throw new Error(`The signing key does not match the escrow ${ACTION === 'release' ? 'seller' : 'buyer'}`);
  }

  const facilitator = loadFacilitatorPublicKey();
  if (authority.publicKey.equals(facilitator)) {
    throw new Error('The facilitator cannot be the escrow authority');
  }

  const recipient = ACTION === 'release' ? escrow.seller : escrow.buyer;
  const recipientToken = await getOrCreateAssociatedTokenAccount(
    connection,
    authority,
    escrow.mint,
    recipient,
  );
  const [vault] = PublicKey.findProgramAddressSync(
    [Buffer.from('vault'), escrowAddress.toBuffer()],
    programId,
  );

  const instruction = ACTION === 'release'
    ? new TransactionInstruction({
        programId,
        data: RELEASE_DISCRIMINATOR,
        keys: [
          { pubkey: escrow.buyer, isSigner: false, isWritable: true },
          { pubkey: escrow.seller, isSigner: true, isWritable: false },
          { pubkey: escrow.mint, isSigner: false, isWritable: false },
          { pubkey: escrowAddress, isSigner: false, isWritable: true },
          { pubkey: vault, isSigner: false, isWritable: true },
          { pubkey: recipientToken.address, isSigner: false, isWritable: true },
          { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        ],
      })
    : new TransactionInstruction({
        programId,
        data: REFUND_DISCRIMINATOR,
        keys: [
          { pubkey: escrow.buyer, isSigner: true, isWritable: true },
          { pubkey: escrow.mint, isSigner: false, isWritable: false },
          { pubkey: escrowAddress, isSigner: false, isWritable: true },
          { pubkey: vault, isSigner: false, isWritable: true },
          { pubkey: recipientToken.address, isSigner: false, isWritable: true },
          { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        ],
      });

  const transaction = new Transaction().add(instruction);
  transaction.feePayer = facilitator;
  transaction.recentBlockhash = (await connection.getLatestBlockhash('confirmed')).blockhash;
  transaction.partialSign(authority);

  const response = await fetch(`${FACILITATOR_URL}/api`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      escrowAddress: escrowAddress.toBase58(),
      action: ACTION,
      transaction: transaction.serialize({
        requireAllSignatures: false,
        verifySignatures: false,
      }).toString('base64'),
    }),
  });
  const result = await response.json();
  console.log('Settlement:', JSON.stringify(result));
  if (!response.ok || result.success !== true) {
    throw new Error('Settlement failed');
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
