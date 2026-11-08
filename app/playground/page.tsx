"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { Buffer } from "buffer";
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
import { Nav } from "../components/ui/Nav";
import "./page.css";

const ESCROW_PROGRAM_ID = "AwtzyMZqxncdqDgpXRnQ2s7Y6zKMmEA8YfCDdLqsPefM";
const USDC_MINT = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
const SOLANA_RPC_URL = "https://api.devnet.solana.com";
const MAX_CREDIT = BigInt(100_000_000);

type CreditAccount = { address: PublicKey; balance: bigint; nextNonce: bigint };

type PaymentTerms = {
  scheme: string;
  network: string;
  payTo: string;
  asset: string;
  maxAmountRequired: string;
  extra?: { escrowProgramId?: string; creditModel?: string; serviceId?: string };
};

function base64(value: Uint8Array | string): string {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

async function discriminator(namespace: string, name: string): Promise<Buffer> {
  const input = new TextEncoder().encode(`${namespace}:${name}`);
  const digest = await crypto.subtle.digest("SHA-256", input);
  return Buffer.from(digest).subarray(0, 8);
}

function parseBuyerKey(value: string): Keypair {
  try {
    return Keypair.fromSecretKey(bs58.decode(value.trim()));
  } catch {
    throw new Error("Enter a valid base58 Solana buyer private key.");
  }
}

function parseUsdcAmount(value: string): bigint {
  if (!/^\d+(\.\d{1,6})?$/.test(value.trim())) {
    throw new Error("Enter a USDC amount with up to 6 decimal places.");
  }
  const [whole, fraction = ""] = value.trim().split(".");
  const amount = BigInt(whole) * BigInt(1_000_000) + BigInt(fraction.padEnd(6, "0"));
  if (amount < BigInt(1_000_000) || amount > MAX_CREDIT) {
    throw new Error("Deposit must be between 1 and 100 USDC.");
  }
  return amount;
}

function formatUsdc(amount: bigint): string {
  return `${amount / BigInt(1_000_000)}.${(amount % BigInt(1_000_000)).toString().padStart(6, "0")}`;
}

async function getCreditAccount(
  connection: Connection,
  buyer: PublicKey,
  seller: PublicKey,
): Promise<CreditAccount> {
  const programId = new PublicKey(ESCROW_PROGRAM_ID);
  const mint = new PublicKey(USDC_MINT);
  const [address] = PublicKey.findProgramAddressSync(
    [Buffer.from("credit"), buyer.toBuffer(), seller.toBuffer(), mint.toBuffer()],
    programId,
  );
  const account = await connection.getAccountInfo(address, "confirmed");
  if (!account) return { address, balance: BigInt(0), nextNonce: BigInt(0) };
  const expectedDiscriminator = await discriminator("account", "Credit");
  if (
    !account.owner.equals(programId) || account.data.length < 121 ||
    !account.data.subarray(0, 8).equals(expectedDiscriminator) ||
    !new PublicKey(account.data.subarray(8, 40)).equals(buyer) ||
    !new PublicKey(account.data.subarray(40, 72)).equals(seller) ||
    !new PublicKey(account.data.subarray(72, 104)).equals(mint)
  ) {
    throw new Error(`Invalid GHOSTRAIL credit account at ${address.toBase58()}.`);
  }
  return {
    address,
    balance: account.data.readBigUInt64LE(104),
    nextNonce: account.data.readBigUInt64LE(112),
  };
}

async function getBuyerTokenAccount(connection: Connection, buyer: Keypair): Promise<PublicKey> {
  const mint = new PublicKey(USDC_MINT);
  const tokenAccount = getAssociatedTokenAddressSync(mint, buyer.publicKey);
  if (await connection.getAccountInfo(tokenAccount, "confirmed")) return tokenAccount;
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  const transaction = new Transaction({ feePayer: buyer.publicKey, recentBlockhash: blockhash }).add(
    createAssociatedTokenAccountInstruction(buyer.publicKey, tokenAccount, buyer.publicKey, mint),
  );
  transaction.sign(buyer);
  const signature = await connection.sendRawTransaction(transaction.serialize());
  const confirmation = await connection.confirmTransaction(
    { signature, blockhash, lastValidBlockHeight },
    "confirmed",
  );
  if (confirmation.value.err) throw new Error("Could not create the buyer USDC token account.");
  return tokenAccount;
}

async function runCreditAction(
  action: "check" | "deposit" | "withdraw",
  privateKey: string,
  buyerAddress: string,
  sellerValue: string,
  depositAmount: string,
): Promise<string> {
  let buyer: Keypair | undefined;
  let buyerPublicKey: PublicKey;
  if (action === "check") {
    try {
      buyerPublicKey = new PublicKey(buyerAddress.trim());
    } catch {
      throw new Error("Enter a valid Solana buyer address.");
    }
  } else {
    buyer = parseBuyerKey(privateKey);
    buyerPublicKey = buyer.publicKey;
  }
  let seller: PublicKey;
  try {
    seller = new PublicKey(sellerValue.trim());
  } catch {
    throw new Error("Enter a valid Solana seller address.");
  }
  if (buyerPublicKey.equals(seller)) throw new Error("Buyer and seller must be different wallets.");

  const connection = new Connection(SOLANA_RPC_URL, "confirmed");
  const credit = await getCreditAccount(connection, buyerPublicKey, seller);
  if (action === "check") {
    return JSON.stringify({
      buyer: buyerPublicKey.toBase58(),
      seller: seller.toBase58(),
      creditAccount: credit.address.toBase58(),
      balanceUsdc: formatUsdc(credit.balance),
      balanceBaseUnits: credit.balance.toString(),
    }, null, 2);
  }

  const programId = new PublicKey(ESCROW_PROGRAM_ID);
  const mint = new PublicKey(USDC_MINT);
  const [vault] = PublicKey.findProgramAddressSync([Buffer.from("vault"), credit.address.toBuffer()], programId);
  if (action === "deposit") {
    if (!buyer) throw new Error("Buyer private key is required for deposits.");
    const amount = parseUsdcAmount(depositAmount);
    if (credit.balance + amount > MAX_CREDIT) {
      throw new Error("Deposit would exceed the 100 USDC prepaid credit cap.");
    }
    const buyerSol = await connection.getBalance(buyer.publicKey, "confirmed");
    if (buyerSol < 10_000_000) throw new Error("Buyer wallet needs at least 0.01 devnet SOL for fees and rent.");
    const buyerToken = await getBuyerTokenAccount(connection, buyer);
    const balance = await connection.getTokenAccountBalance(buyerToken, "confirmed");
    if (BigInt(balance.value.amount) < amount) {
      throw new Error("The buyer USDC token account has insufficient funds.");
    }

    const data = Buffer.alloc(16);
    (await discriminator("global", "deposit_credit")).copy(data, 0);
    data.writeBigUInt64LE(amount, 8);
    const instruction = new TransactionInstruction({
      programId,
      keys: [
        { pubkey: buyer.publicKey, isSigner: true, isWritable: true },
        { pubkey: seller, isSigner: false, isWritable: false },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: credit.address, isSigner: false, isWritable: true },
        { pubkey: buyerToken, isSigner: false, isWritable: true },
        { pubkey: vault, isSigner: false, isWritable: true },
        { pubkey: getAssociatedTokenAddressSync(mint, seller), isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      ],
      data,
    });
    const { blockhash } = await connection.getLatestBlockhash("confirmed");
    const transaction = new Transaction({ feePayer: buyer.publicKey, recentBlockhash: blockhash }).add(instruction);
    transaction.sign(buyer);
    const response = await fetch("/api/settlements", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "deposit", transaction: transaction.serialize().toString("base64") }),
    });
    const result = await response.json();
    if (!response.ok || result.success !== true) {
      throw new Error(result.error || "Prepaid USDC deposit failed.");
    }
    return JSON.stringify({
      signature: result.signature,
      creditAccount: result.creditAddress,
      balanceUsdc: formatUsdc(BigInt(result.balance)),
    }, null, 2);
  }

  if (credit.balance === BigInt(0)) throw new Error("No prepaid USDC remains to withdraw.");
  if (!buyer) throw new Error("Buyer private key is required for withdrawals.");
  const buyerToken = await getBuyerTokenAccount(connection, buyer);
  const data = Buffer.alloc(16);
  (await discriminator("global", "withdraw_credit")).copy(data, 0);
  data.writeBigUInt64LE(credit.balance, 8);
  const instruction = new TransactionInstruction({
    programId,
    keys: [
      { pubkey: buyer.publicKey, isSigner: true, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: credit.address, isSigner: false, isWritable: true },
      { pubkey: vault, isSigner: false, isWritable: true },
      { pubkey: buyerToken, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data,
  });
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  const transaction = new Transaction({ feePayer: buyer.publicKey, recentBlockhash: blockhash }).add(instruction);
  transaction.sign(buyer);
  const signature = await connection.sendRawTransaction(transaction.serialize());
  const confirmation = await connection.confirmTransaction(
    { signature, blockhash, lastValidBlockHeight },
    "confirmed",
  );
  if (confirmation.value.err) throw new Error("USDC withdrawal transaction failed.");
  return JSON.stringify({
    signature,
    withdrawnUsdc: formatUsdc(credit.balance),
    remainingBalanceUsdc: "0.000000",
  }, null, 2);
}

async function createPayment(
  challengeBody: string,
  buyerPrivateKey: string,
): Promise<{ payment: string; serviceId: string | null }> {
  let challenge: { x402Version?: number; accepts?: PaymentTerms[] };
  try {
    challenge = JSON.parse(challengeBody);
  } catch {
    throw new Error("The endpoint returned an invalid payment challenge.");
  }
  const terms = challenge.accepts?.find(
    (item) => item?.scheme === "escrow" && item?.network === "solana-devnet",
  );
  if (
    challenge.x402Version !== 1 || !terms?.payTo || !terms.maxAmountRequired ||
    terms.asset !== USDC_MINT || terms.extra?.escrowProgramId !== ESCROW_PROGRAM_ID ||
    terms.extra?.creditModel !== "prepaid"
  ) {
    throw new Error("The endpoint did not return supported GHOSTRAIL prepaid payment terms.");
  }

  let buyer: Keypair;
  try {
    buyer = Keypair.fromSecretKey(bs58.decode(buyerPrivateKey.trim()));
  } catch {
    throw new Error("Enter a valid base58 Solana buyer private key.");
  }

  const programId = new PublicKey(ESCROW_PROGRAM_ID);
  const mint = new PublicKey(USDC_MINT);
  const seller = new PublicKey(terms.payTo);
  if (buyer.publicKey.equals(seller)) {
    throw new Error("The buyer wallet and service seller wallet must be different.");
  }
  let amount: bigint;
  try {
    amount = BigInt(terms.maxAmountRequired);
  } catch {
    throw new Error("The endpoint returned an invalid payment amount.");
  }
  if (amount <= BigInt(0)) throw new Error("The endpoint returned an invalid payment amount.");

  const [credit] = PublicKey.findProgramAddressSync(
    [Buffer.from("credit"), buyer.publicKey.toBuffer(), seller.toBuffer(), mint.toBuffer()],
    programId,
  );
  const [vault] = PublicKey.findProgramAddressSync([Buffer.from("vault"), credit.toBuffer()], programId);
  const connection = new Connection(SOLANA_RPC_URL, "confirmed");
  const account = await connection.getAccountInfo(credit, "confirmed");
  let balance = BigInt(0);
  let nonce = BigInt(0);
  if (account) {
    const expectedDiscriminator = await discriminator("account", "Credit");
    if (
      !account.owner.equals(programId) || account.data.length < 121 ||
      !account.data.subarray(0, 8).equals(expectedDiscriminator) ||
      !new PublicKey(account.data.subarray(8, 40)).equals(buyer.publicKey) ||
      !new PublicKey(account.data.subarray(40, 72)).equals(seller) ||
      !new PublicKey(account.data.subarray(72, 104)).equals(mint)
    ) {
      throw new Error("The buyer/seller prepaid credit account is invalid.");
    }
    balance = account.data.readBigUInt64LE(104);
    nonce = account.data.readBigUInt64LE(112);
  }
  if (balance < amount) {
    throw new Error("Insufficient prepaid USDC credit for this service.");
  }

  const data = Buffer.alloc(24);
  (await discriminator("global", "charge_credit")).copy(data, 0);
  data.writeBigUInt64LE(amount, 8);
  data.writeBigUInt64LE(nonce, 16);
  const instruction = new TransactionInstruction({
    programId,
    keys: [
      { pubkey: buyer.publicKey, isSigner: true, isWritable: true },
      { pubkey: seller, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: credit, isSigner: false, isWritable: true },
      { pubkey: vault, isSigner: false, isWritable: true },
      { pubkey: getAssociatedTokenAddressSync(mint, seller), isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data,
  });
  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  const transaction = new Transaction({ feePayer: buyer.publicKey, recentBlockhash: blockhash }).add(instruction);
  transaction.sign(buyer);
  return {
    payment: base64(JSON.stringify({
      x402Version: 1,
      scheme: "escrow",
      network: "solana-devnet",
      payload: { transaction: transaction.serialize().toString("base64") },
    })),
    serviceId: terms.extra?.serviceId ?? null,
  };
}

type PlaygroundResult = {
  status: number;
  statusText: string;
  body: string;
  receipt: string | null;
};

export default function PlaygroundPage() {
  const [mode, setMode] = useState<"endpoint" | "check" | "deposit" | "withdraw">("endpoint");
  const [endpoint, setEndpoint] = useState("");
  const [prompt, setPrompt] = useState("Hello from the GHOSTRAIL playground");
  const [buyerPrivateKey, setBuyerPrivateKey] = useState("");
  const [buyerAddress, setBuyerAddress] = useState("");
  const [sellerAddress, setSellerAddress] = useState("");
  const [depositAmount, setDepositAmount] = useState("1");
  const [result, setResult] = useState<PlaygroundResult | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function sendRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setResult(null);

    let parsedEndpoint: URL | undefined;
    if (mode === "endpoint") {
      try {
        parsedEndpoint = new URL(endpoint.trim());
      } catch {
        setError("Enter a valid service endpoint URL.");
        return;
      }
      if (parsedEndpoint.protocol !== "https:" && parsedEndpoint.protocol !== "http:") {
        setError("The endpoint must use HTTP or HTTPS.");
        return;
      }
    } else if (mode === "check" && !buyerAddress.trim()) {
      setError("Enter the buyer wallet address.");
      return;
    } else if (mode !== "check" && !buyerPrivateKey.trim()) {
      setError("Enter the buyer private key to manage prepaid credit.");
      return;
    } else if (!sellerAddress.trim()) {
      setError("Enter the seller wallet address.");
      return;
    }

    const paidCall = mode === "endpoint" && buyerPrivateKey.trim().length > 0;
    setLoading(true);
    try {
      if (mode !== "endpoint") {
        const body = await runCreditAction(mode, buyerPrivateKey, buyerAddress, sellerAddress, depositAmount);
        setResult({
          status: 200,
          statusText: mode === "check" ? "Credit balance" : mode === "deposit" ? "Deposit confirmed" : "Withdrawal confirmed",
          body,
          receipt: null,
        });
        return;
      }
      if (!parsedEndpoint) throw new Error("Enter a valid service endpoint URL.");

      const sendToEndpoint = async (payment?: string) => fetch("/api/playground", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          endpoint: parsedEndpoint.toString(),
          prompt,
          payment,
        }),
        cache: "no-store",
      });
      let response = await sendToEndpoint();
      let data = await response.json();
      let serviceId: string | null = null;
      let didPay = false;
      if (!response.ok) {
        throw new Error(data.error || `Request failed (${response.status}).`);
      }
      if (buyerPrivateKey.trim() && data.status === 402) {
        const signedPayment = await createPayment(data.body, buyerPrivateKey);
        serviceId = signedPayment.serviceId;
        didPay = true;
        setBuyerPrivateKey("");
        response = await sendToEndpoint(signedPayment.payment);
        data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || `Request failed (${response.status}).`);
        }
      }
      let displayBody = data.body;
      if (paidCall && data.status !== 402) {
        let serviceBody: Record<string, unknown>;
        try {
          serviceBody = JSON.parse(data.body);
        } catch {
          throw new Error("The paid service returned an invalid JSON response.");
        }
        let transaction: string | null = null;
        if (didPay && !data.receipt) {
          throw new Error("Service response did not include X-PAYMENT-RESPONSE.");
        }
        if (data.receipt) {
          let receipt: { success?: boolean; network?: string; transaction?: string };
          try {
            receipt = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(data.receipt), (char) => char.charCodeAt(0))));
          } catch {
            throw new Error("Service returned an invalid X-PAYMENT-RESPONSE receipt.");
          }
          const payment = serviceBody.payment as { accepted?: boolean } | undefined;
          const charge = serviceBody.charge as { success?: boolean; signature?: string } | undefined;
          if (
            payment?.accepted !== true || charge?.success !== true ||
            receipt.success !== true || receipt.network !== "solana-devnet" ||
            receipt.transaction !== charge.signature
          ) {
            throw new Error("Service response did not include a matching confirmed payment receipt.");
          }
          transaction = receipt.transaction;
        }
        displayBody = JSON.stringify({
          response: serviceBody.response ?? serviceBody,
          transaction,
          endpoint: parsedEndpoint.toString(),
          service_id: serviceId,
        }, null, 2);
      }
      setResult({
        status: data.status,
        statusText: data.statusText,
        body: displayBody,
        receipt: paidCall ? null : data.receipt,
      });
    } catch (requestError) {
      const message =
        requestError instanceof Error ? requestError.message : String(requestError);
      setError(message);
    } finally {
      setBuyerPrivateKey("");
      setLoading(false);
    }
  }

  return (
    <div className="pg">
      <div className="in">
        <Nav />
        <main className="playground-page">
          <header className="playground-header">
            <h1 className="playground-title">x402 Playground</h1>
            <p className="mut playground-intro">
              Inspect or call a service, then check, deposit, or withdraw a
              buyer&apos;s prepaid USDC credit for a seller.
            </p>
          </header>

          <div className="playground-grid">
            <form className="playground-form" onSubmit={sendRequest}>
              <label className="playground-field">
                <span>Action</span>
                <select value={mode} onChange={(event) => setMode(event.target.value as typeof mode)}>
                  <option value="endpoint">Inspect / call service</option>
                  <option value="check">Check prepaid credit</option>
                  <option value="deposit">Deposit USDC credit</option>
                  <option value="withdraw">Withdraw remaining credit</option>
                </select>
              </label>

              {mode === "endpoint" ? (
                <>
                  <label className="playground-field">
                    <span>Service endpoint</span>
                    <input
                      type="url"
                      required
                      placeholder="https://api.example.com"
                      value={endpoint}
                      onChange={(event) => setEndpoint(event.target.value)}
                    />
                  </label>

                  <label className="playground-field">
                    <span>Prompt</span>
                    <textarea
                      rows={3}
                      value={prompt}
                      onChange={(event) => setPrompt(event.target.value)}
                    />
                  </label>
                </>
              ) : (
                <>
                  {mode === "check" && (
                    <label className="playground-field">
                      <span>Buyer wallet address</span>
                      <input
                        type="text"
                        required
                        placeholder="Solana public key"
                        value={buyerAddress}
                        onChange={(event) => setBuyerAddress(event.target.value)}
                      />
                    </label>
                  )}
                  <label className="playground-field">
                    <span>Seller wallet address</span>
                    <input
                      type="text"
                      required
                      placeholder="Solana public key"
                      value={sellerAddress}
                      onChange={(event) => setSellerAddress(event.target.value)}
                    />
                  </label>
                  {mode === "deposit" && (
                    <label className="playground-field">
                      <span>Deposit amount <em>USDC</em></span>
                      <input
                        type="number"
                        min="1"
                        max="100"
                        step="0.000001"
                        required
                        value={depositAmount}
                        onChange={(event) => setDepositAmount(event.target.value)}
                      />
                    </label>
                  )}
                </>
              )}

              {mode !== "check" && (
                <label className="playground-field">
                  <span>Buyer private key <em>{mode === "endpoint" ? "Optional" : "Required"}</em></span>
                  <input
                    type="password"
                    autoComplete="off"
                    placeholder="Base58 Solana private key"
                    value={buyerPrivateKey}
                    onChange={(event) => setBuyerPrivateKey(event.target.value)}
                  />
                  <small>
                    {mode === "endpoint"
                      ? "Leave blank to inspect the service's 402 challenge. With a key, the browser signs a prepaid USDC charge locally. The private key is not sent to the server."
                      : "Used in this browser to sign the selected credit action. The private key is not sent to the server."}
                  </small>
                </label>
              )}

              <button
                className="btn playground-submit"
                type="submit"
                disabled={loading}
              >
                {loading
                  ? "Sending..."
                  : mode === "endpoint"
                    ? buyerPrivateKey.trim() ? "Send paid request" : "Inspect endpoint"
                    : mode === "check" ? "Check credit" : mode === "deposit" ? "Deposit USDC" : "Withdraw credit"}
              </button>

              {error && (
                <p className="playground-error" role="alert">
                  {error}
                </p>
              )}
            </form>

            <section
              className="playground-output"
              aria-labelledby="playground-output-title"
              aria-live="polite"
            >
              <div className="playground-output-heading">
                <h2 id="playground-output-title">Response</h2>
                {result && (
                  <span
                    className={`playground-status${result.status === 402 ? " is-challenge" : ""}`}
                  >
                    {result.status} {result.statusText}
                  </span>
                )}
              </div>
              {result ? (
                <>
                  <pre className="playground-response">
                    {result.body || "(empty response body)"}
                  </pre>
                  {result.receipt && (
                    <div className="playground-receipt">
                      <strong>X-PAYMENT-RESPONSE</strong>
                      <code>{result.receipt}</code>
                    </div>
                  )}
                </>
              ) : (
                <>
                  <p className="mut playground-placeholder">
                    The endpoint response and any payment receipt will appear here.
                  </p>
                  <div className="playground-inset" aria-hidden="true" />
                </>
              )}
            </section>
          </div>

          <aside className="playground-note">
            <p className="mut">
              The playground forwards requests from the server, so the service
              does not need browser CORS support. The service must be publicly
              reachable over HTTP or HTTPS; local and private network addresses
              are blocked. Your private key stays in this browser and is used
              to sign the payment locally; the server receives only the signed
              transaction. Credit actions use Solana devnet; deposits and
              withdrawals submit on-chain transactions.
            </p>
            <Link href="/docs" className="playground-docs-link">
              Read the integration guide
            </Link>
          </aside>
        </main>
      </div>
    </div>
  );
}
