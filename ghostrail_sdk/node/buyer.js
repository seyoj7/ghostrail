import { createHash } from "node:crypto";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import bs58 from "bs58";

const DEVNET_USDC_MINT = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
const DEFAULT_SOLANA_RPC_URL = "https://api.devnet.solana.com";
const COMMITMENT = "confirmed";
const MIN_DEPOSIT = 1_000_000n;
const MAX_CREDIT = 100_000_000n;

function discriminator(namespace, name) {
  return createHash("sha256").update(`${namespace}:${name}`).digest().subarray(0, 8);
}

function requireValue(name, value) {
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function asKeypair(privateKey) {
  try {
    const secret = bs58.decode(requireValue("buyerPrivateKey", privateKey));
    return Keypair.fromSecretKey(secret);
  } catch (error) {
    throw new Error("buyerPrivateKey must be a valid base58 Solana private key", { cause: error });
  }
}

function asPublicKey(value, name) {
  try {
    return new PublicKey(requireValue(name, value));
  } catch (error) {
    throw new Error(`${name} must be a valid Solana address`, { cause: error });
  }
}

function amountToBaseUnits(amount) {
  const text = String(amount);
  if (!/^\d+(\.\d{1,6})?$/.test(text)) {
    throw new Error("USDC amount must be positive with at most 6 decimal places");
  }
  const [whole, fraction = ""] = text.split(".");
  const baseUnits = BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
  if (baseUnits <= 0n) throw new Error("USDC amount must be positive");
  return baseUnits;
}

function u64(value) {
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64LE(value);
  return bytes;
}

function deriveCreditAddress(programId, buyer, seller, mint) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("credit"), buyer.toBuffer(), seller.toBuffer(), mint.toBuffer()],
    programId,
  )[0];
}

function deriveVaultAddress(programId, credit) {
  return PublicKey.findProgramAddressSync([Buffer.from("vault"), credit.toBuffer()], programId)[0];
}

function formatUsdc(amount) {
  const baseUnits = BigInt(amount);
  return `${baseUnits / 1_000_000n}.${(baseUnits % 1_000_000n).toString().padStart(6, "0")} USDC (${baseUnits.toLocaleString("en-US")} base units)`;
}

async function jsonResponse(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch (error) {
    throw new Error(`Expected JSON response (HTTP ${response.status})`, { cause: error });
  }
}

async function confirm(connection, signature, blockhash, lastValidBlockHeight) {
  const result = await connection.confirmTransaction(
    { signature, blockhash, lastValidBlockHeight },
    COMMITMENT,
  );
  if (result.value.err) throw new Error(`Solana transaction failed: ${JSON.stringify(result.value.err)}`);
}

export class Ghostrail {
  constructor({
    rpcUrl = process.env.SOLANA_RPC_URL || DEFAULT_SOLANA_RPC_URL,
    programId = process.env.ESCROW_PROGRAM_ID,
    mint = process.env.USDC_MINT || DEVNET_USDC_MINT,
    facilitatorUrl = process.env.FACILITATOR_URL || "http://127.0.0.1:3000",
  } = {}) {
    this.connection = new Connection(requireValue("SOLANA_RPC_URL", rpcUrl), COMMITMENT);
    this.programId = asPublicKey(programId, "ESCROW_PROGRAM_ID");
    this.mint = asPublicKey(mint, "USDC_MINT");
    this.facilitatorUrl = facilitatorUrl.replace(/\/$/, "");
  }

  async checkCredit(buyerAddress, sellerAddress) {
    const buyer = asPublicKey(buyerAddress, "buyerAddress");
    const seller = asPublicKey(sellerAddress, "sellerAddress");
    const credit = deriveCreditAddress(this.programId, buyer, seller, this.mint);
    const account = await this.connection.getAccountInfo(credit, COMMITMENT);
    if (!account) return "0.000000";

    const data = account.data;
    const expectedDiscriminator = discriminator("account", "Credit");
    if (
      !account.owner.equals(this.programId) ||
      data.length < 121 ||
      !data.subarray(0, 8).equals(expectedDiscriminator) ||
      !new PublicKey(data.subarray(8, 40)).equals(buyer) ||
      !new PublicKey(data.subarray(40, 72)).equals(seller) ||
      !new PublicKey(data.subarray(72, 104)).equals(this.mint)
    ) {
      throw new Error(`Invalid GHOSTRAIL credit account at ${credit.toBase58()}`);
    }
    return formatUsdc(data.readBigUInt64LE(104)).split(" ")[0];
  }

  async callService(buyerPrivateKey, endpointUrl, prompt = "Explain Solana escrow in one sentence.", serviceId) {
    const buyer = asKeypair(buyerPrivateKey);
    requireValue("endpointUrl", endpointUrl);
    const challengeResponse = await fetch(endpointUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt }),
    });
    if (challengeResponse.status !== 402) {
      const body = await jsonResponse(challengeResponse);
      if (!challengeResponse.ok) throw new Error(`Service returned HTTP ${challengeResponse.status}: ${JSON.stringify(body)}`);
      return { response: body.response ?? body, transaction: null, endpoint: endpointUrl, service_id: serviceId ?? process.env.SERVICE_ID ?? null };
    }

    const challenge = await jsonResponse(challengeResponse);
    const terms = Array.isArray(challenge.accepts)
      ? challenge.accepts.find((item) => item?.scheme === "escrow" && item?.network === "solana-devnet")
      : undefined;
    if (
      challenge.x402Version !== 1 || !terms?.payTo || !terms.maxAmountRequired || !terms.asset ||
      !terms.extra?.escrowProgramId || terms.extra?.creditModel !== "prepaid"
    ) {
      throw new Error(`Service returned invalid prepaid payment requirements: ${JSON.stringify(challenge)}`);
    }
    serviceId = serviceId ?? process.env.SERVICE_ID ?? terms.extra.serviceId ?? null;

    const seller = asPublicKey(terms.payTo, "service seller address");
    if (buyer.publicKey.equals(seller)) {
      throw new Error("The buyer wallet and service seller wallet must be different");
    }
    const mint = asPublicKey(terms.asset, "service USDC mint");
    const programId = asPublicKey(terms.extra.escrowProgramId, "service escrow program ID");
    if (!mint.equals(this.mint) || !programId.equals(this.programId)) {
      throw new Error("Service payment terms do not match this SDK's USDC mint and escrow program");
    }
    const amount = BigInt(terms.maxAmountRequired);
    const credit = deriveCreditAddress(this.programId, buyer.publicKey, seller, this.mint);
    const account = await this.getCreditAccount(buyer.publicKey, seller);
    if (account.balance < amount) {
      throw new Error(`Insufficient prepaid credit (${formatUsdc(account.balance)} available; ${formatUsdc(amount)} required)`);
    }

    const vault = deriveVaultAddress(this.programId, credit);
    const sellerToken = getAssociatedTokenAddressSync(this.mint, seller);
    const data = Buffer.concat([
      discriminator("global", "charge_credit"),
      u64(amount),
      u64(account.nextNonce),
    ]);
    const instruction = new TransactionInstruction({
      programId: this.programId,
      keys: [
        { pubkey: buyer.publicKey, isSigner: true, isWritable: true },
        { pubkey: seller, isSigner: false, isWritable: false },
        { pubkey: this.mint, isSigner: false, isWritable: false },
        { pubkey: credit, isSigner: false, isWritable: true },
        { pubkey: vault, isSigner: false, isWritable: true },
        { pubkey: sellerToken, isSigner: false, isWritable: true },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      ],
      data,
    });
    const { blockhash } = await this.connection.getLatestBlockhash(COMMITMENT);
    const transaction = new Transaction({ feePayer: buyer.publicKey, recentBlockhash: blockhash }).add(instruction);
    transaction.sign(buyer);
    const signedBase64 = transaction.serialize().toString("base64");
    const payment = Buffer.from(JSON.stringify({
      x402Version: 1,
      scheme: "escrow",
      network: "solana-devnet",
      payload: { transaction: signedBase64 },
    })).toString("base64");

    const response = await fetch(endpointUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-PAYMENT": payment },
      body: JSON.stringify({ prompt }),
    });
    const body = await jsonResponse(response);
    if (!response.ok) throw new Error(`Paid service returned HTTP ${response.status}: ${JSON.stringify(body)}`);
    const receiptHeader = response.headers.get("X-PAYMENT-RESPONSE");
    if (!receiptHeader) throw new Error("Service response did not include X-PAYMENT-RESPONSE");
    let receipt;
    try {
      receipt = JSON.parse(Buffer.from(receiptHeader, "base64").toString("utf8"));
    } catch (error) {
      throw new Error("Service returned an invalid X-PAYMENT-RESPONSE header", { cause: error });
    }
    if (
      body.payment?.accepted !== true || body.charge?.success !== true ||
      receipt?.success !== true || receipt?.network !== "solana-devnet" ||
      receipt?.transaction !== body.charge?.signature
    ) {
      throw new Error("Service response did not include a matching confirmed payment receipt");
    }
    return {
      response: body.response ?? body,
      transaction: receipt.transaction,
      endpoint: endpointUrl,
      service_id: serviceId,
    };
  }

  async depositCredit(buyerPrivateKey, sellerAddress, amountUsdc = "1") {
    const buyer = asKeypair(buyerPrivateKey);
    const seller = asPublicKey(sellerAddress, "sellerAddress");
    if (buyer.publicKey.equals(seller)) throw new Error("Buyer and seller must be different wallets");
    const amount = amountToBaseUnits(amountUsdc);
    if (amount < MIN_DEPOSIT || amount > MAX_CREDIT) throw new Error("Deposit must be between 1 and 100 USDC");
    const current = await this.getCreditAccount(buyer.publicKey, seller);
    if (current.balance + amount > MAX_CREDIT) throw new Error("Deposit would exceed the 100 USDC credit cap");

    console.log(`Buyer          : ${buyer.publicKey.toBase58()}`);
    console.log(`Seller         : ${seller.toBase58()}`);
    console.log(`Credit account : ${current.credit.toBase58()}`);
    console.log(`Deposit        : ${formatUsdc(amount)}`);

    const buyerBalance = await this.connection.getBalance(buyer.publicKey, COMMITMENT);
    if (buyerBalance < 10_000_000) throw new Error("Buyer wallet needs at least 0.01 devnet SOL for fees and rent");
    const buyerToken = await this.getOrCreateBuyerTokenAccount(buyer);
    const tokenBalance = await this.connection.getTokenAccountBalance(buyerToken, COMMITMENT);
    if (BigInt(tokenBalance.value.amount) < amount) throw new Error("Buyer USDC token account has insufficient funds");

    const credit = deriveCreditAddress(this.programId, buyer.publicKey, seller, this.mint);
    const vault = deriveVaultAddress(this.programId, credit);
    const sellerToken = getAssociatedTokenAddressSync(this.mint, seller);
    const instruction = new TransactionInstruction({
      programId: this.programId,
      keys: [
        { pubkey: buyer.publicKey, isSigner: true, isWritable: true },
        { pubkey: seller, isSigner: false, isWritable: false },
        { pubkey: this.mint, isSigner: false, isWritable: false },
        { pubkey: credit, isSigner: false, isWritable: true },
        { pubkey: buyerToken, isSigner: false, isWritable: true },
        { pubkey: vault, isSigner: false, isWritable: true },
        { pubkey: sellerToken, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      ],
      data: Buffer.concat([discriminator("global", "deposit_credit"), u64(amount)]),
    });
    const { blockhash } = await this.connection.getLatestBlockhash(COMMITMENT);
    const transaction = new Transaction({ feePayer: buyer.publicKey, recentBlockhash: blockhash }).add(instruction);
    transaction.sign(buyer);
    const transactionBase64 = transaction.serialize().toString("base64");
    const response = await fetch(`${this.facilitatorUrl}/api`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "deposit", transaction: transactionBase64 }),
    });
    const result = await jsonResponse(response);
    if (!response.ok || result.success !== true) throw new Error(`Prepaid USDC deposit failed: ${JSON.stringify(result)}`);
    console.log(`Deposit confirmed: ${result.signature}`);
    console.log(`Available credit : ${formatUsdc(BigInt(result.balance))}`);
    return result;
  }

  async withdrawCredit(buyerPrivateKey, sellerAddress) {
    const buyer = asKeypair(buyerPrivateKey);
    const seller = asPublicKey(sellerAddress, "sellerAddress");
    const credit = deriveCreditAddress(this.programId, buyer.publicKey, seller, this.mint);
    const current = await this.getCreditAccount(buyer.publicKey, seller);
    if (current.balance === 0n) {
      console.log("No prepaid USDC remains for this buyer and seller.");
      return null;
    }
    console.log(`Buyer          : ${buyer.publicKey.toBase58()}`);
    console.log(`Seller         : ${seller.toBase58()}`);
    console.log(`Credit account : ${current.credit.toBase58()}`);
    console.log(`Withdrawal     : ${formatUsdc(current.balance)}`);
    const buyerToken = await this.getOrCreateBuyerTokenAccount(buyer);
    const vault = deriveVaultAddress(this.programId, credit);
    const instruction = new TransactionInstruction({
      programId: this.programId,
      keys: [
        { pubkey: buyer.publicKey, isSigner: true, isWritable: true },
        { pubkey: this.mint, isSigner: false, isWritable: false },
        { pubkey: credit, isSigner: false, isWritable: true },
        { pubkey: vault, isSigner: false, isWritable: true },
        { pubkey: buyerToken, isSigner: false, isWritable: true },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      ],
      data: Buffer.concat([discriminator("global", "withdraw_credit"), u64(current.balance)]),
    });
    const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash(COMMITMENT);
    const transaction = new Transaction({ feePayer: buyer.publicKey, recentBlockhash: blockhash }).add(instruction);
    transaction.sign(buyer);
    const signature = await this.connection.sendRawTransaction(transaction.serialize());
    await confirm(this.connection, signature, blockhash, lastValidBlockHeight);
    console.log(`Withdrawal confirmed: ${signature}`);
    console.log("Available credit   : 0.000000 USDC (0 base units)");
    return signature;
  }

  async getCreditAccount(buyer, seller) {
    const credit = deriveCreditAddress(this.programId, buyer, seller, this.mint);
    const account = await this.connection.getAccountInfo(credit, COMMITMENT);
    if (!account) return { credit, balance: 0n, nextNonce: 0n };
    const data = account.data;
    const expectedDiscriminator = discriminator("account", "Credit");
    if (
      !account.owner.equals(this.programId) ||
      data.length < 121 ||
      !data.subarray(0, 8).equals(expectedDiscriminator) ||
      !new PublicKey(data.subarray(8, 40)).equals(buyer) ||
      !new PublicKey(data.subarray(40, 72)).equals(seller) ||
      !new PublicKey(data.subarray(72, 104)).equals(this.mint)
    ) {
      throw new Error(`Invalid GHOSTRAIL credit account at ${credit.toBase58()}`);
    }
    return { credit, balance: data.readBigUInt64LE(104), nextNonce: data.readBigUInt64LE(112) };
  }

  async getOrCreateBuyerTokenAccount(buyer) {
    const address = getAssociatedTokenAddressSync(this.mint, buyer.publicKey);
    const account = await this.connection.getAccountInfo(address, COMMITMENT);
    if (account) return address;
    const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash(COMMITMENT);
    const transaction = new Transaction({ feePayer: buyer.publicKey, recentBlockhash: blockhash }).add(
      createAssociatedTokenAccountInstruction(buyer.publicKey, address, buyer.publicKey, this.mint),
    );
    transaction.sign(buyer);
    const signature = await this.connection.sendRawTransaction(transaction.serialize());
    await confirm(this.connection, signature, blockhash, lastValidBlockHeight);
    return address;
  }
}
