import "./page.css";
import Link from "next/link";
import { Nav } from "./components/ui/Nav";

export default function Home() {
  return (
    <div className="pg">
      <div className="in">
        <Nav />

        {/* â”€â”€ Hero Section â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
        <div className="hero-block">
          <div className="mono hero-subtitle-tag">
            x402 facilitator for Solana
          </div>
          <h1 className="hero-title">
            Payments that settle. <br />Fees that vanish.
          </h1>
          <p className="mut hero-description">
            AI agents and apps pay for APIs from reusable devnet USDC credit.
            Buyers deposit once, then sign a nonce-protected charge for each
            successful request. Buyers need devnet SOL for fees and rent.
          </p>
          <div className="hero-actions">
            <Link href="/dashboard" className="btn">
              Open dashboard
            </Link>
            <Link href="/services" className="btn2">
              Register a service
            </Link>
          </div>
        </div>

        {/* ── Security, Escrow & Control Architecture ────────────────── */}
        <section
          className="architecture-section"
          aria-labelledby="architecture-title"
        >
          <div className="architecture-header">
            <h2 className="architecture-title" id="architecture-title">
              Security, escrow, and control
            </h2>
            <p className="architecture-subtitle">
              Autonomous AI agent payments start with immutable on-chain guarantees and zero custodial risk.
            </p>
          </div>

          <div className="architecture-grid">
            <div className="architecture-card">
              <div className="architecture-icon">
                <svg
                  width="38"
                  height="38"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <ellipse cx="12" cy="5" rx="9" ry="3" />
                  <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
                  <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
                </svg>
              </div>
              <h3 className="architecture-card-title">Non-custodial credit</h3>
              <p className="architecture-card-desc">
                USDC is held in a buyer and seller specific Anchor PDA. The facilitator cannot spend it without a buyer-signed charge.
              </p>
            </div>

            <div className="architecture-card">
              <div className="architecture-icon">
                <svg
                  width="38"
                  height="38"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              </div>
              <h3 className="architecture-card-title">Fail-closed verification</h3>
              <p className="architecture-card-desc">
                Every transaction instruction is rigorously audited for allowed programs, discriminator shapes, exact token mints, and compute limits before acceptance.
              </p>
            </div>

            <div className="architecture-card">
              <div className="architecture-icon">
                <svg
                  width="38"
                  height="38"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                </svg>
              </div>
              <h3 className="architecture-card-title">Replay &amp; signature audit</h3>
              <p className="architecture-card-desc">
                Accepted transaction signatures are indexed in PostgreSQL to permanently prevent replay attacks and maintain a verifiable delivery log.
              </p>
            </div>

            <div className="architecture-card">
              <div className="architecture-icon">
                <svg
                  width="38"
                  height="38"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                  <line x1="16" y1="13" x2="8" y2="13" />
                  <line x1="16" y1="17" x2="8" y2="17" />
                  <line x1="10" y1="9" x2="8" y2="9" />
                </svg>
              </div>
              <h3 className="architecture-card-title">Withdraw unused credit</h3>
              <p className="architecture-card-desc">
                Buyers can withdraw unused prepaid USDC at any time. A failed API handler does not trigger a charge.
              </p>
            </div>

            <div className="architecture-card">
              <div className="architecture-icon">
                <svg
                  width="38"
                  height="38"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="12" cy="12" r="10" />
                  <line x1="2" y1="12" x2="22" y2="12" />
                  <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                </svg>
              </div>
              <h3 className="architecture-card-title">Devnet transaction fees</h3>
              <p className="architecture-card-desc">
                Buyers pay Solana transaction fees and account rent in devnet SOL for deposits, charges, and withdrawals.
              </p>
            </div>

            <div className="architecture-card">
              <div className="architecture-icon">
                <svg
                  width="38"
                  height="38"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
              </div>
              <h3 className="architecture-card-title">Nonce-protected charges</h3>
              <p className="architecture-card-desc">
                Each credit charge uses the next on-chain nonce and is limited to the seller and mint bound when the buyer deposits.
              </p>
            </div>
          </div>
        </section>

        <section
          className="card integration-card"
          aria-labelledby="seller-integration-title"
        >
          <div className="mono integration-eyebrow">SELLER INTEGRATION</div>
          <h2 className="integration-title" id="seller-integration-title">
            Register your API, integrate verification
          </h2>
          <p className="mut integration-copy">
            In your API handler, return an x402 HTTP 402 challenge when a
            request has no X-PAYMENT header. For a paid request, verify the
            buyer-signed authorization with GHOSTRAIL, run your handler, then
            submit the charge only after the handler succeeds. The buyer funds
            reusable credit separately and signs each charge.
          </p>
          <pre className="integration-code"><code>{`// Configure these on your server; never expose them to browser code.
const FACILITATOR_URL = process.env.GHOSTRAIL_URL!;
const ESCROW_PROGRAM_ID = process.env.ESCROW_PROGRAM_ID!;
const serviceId = process.env.GHOSTRAIL_SERVICE_ID!;
const resourceUrl = request.url;

// In your resource's POST handler:
const serviceResponse = await fetch(
  FACILITATOR_URL + "/api/services/" + serviceId
);
if (!serviceResponse.ok) throw new Error("Unknown GHOSTRAIL service");
const registeredService = await serviceResponse.json();
const { seller, amount, mint } = registeredService.paymentRequirements;

// Return the x402 challenge if the buyer has not sent a charge authorization.
const challenge = {
  x402Version: 1,
  accepts: [{
    scheme: "escrow",
    network: "solana-devnet",
    maxAmountRequired: amount,
    resource: resourceUrl,
    description: registeredService.name,
    mimeType: "application/json",
    payTo: seller,
    asset: mint,
    extra: {
      escrowProgramId: ESCROW_PROGRAM_ID,
      creditModel: "prepaid",
      minDepositAmount: "1000000",
      maxBalanceAmount: "100000000",
    },
  }],
};
const xPayment = request.headers.get("X-PAYMENT");
if (!xPayment) return Response.json(challenge, { status: 402 });

// Verify the signed charge. This does not submit it on-chain yet.
const verifyResponse = await fetch(FACILITATOR_URL + "/api", {
  method: "POST",
  headers: { "Content-Type": "application/json", "X-PAYMENT": xPayment },
  body: JSON.stringify({ serviceId }),
});
const authorization = await verifyResponse.json();
if (!verifyResponse.ok || authorization.accepted !== true) {
  return Response.json({ ...challenge, error: "Payment rejected" }, { status: 402 });
}

// Your handler must throw/reject on failed delivery so the charge is skipped.
const result = await runYourHandler(request);

// Charge only after successful delivery; PUT /api submits and confirms it.
const chargeResponse = await fetch(FACILITATOR_URL + "/api", {
  method: "PUT",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    action: "charge",
    creditAddress: authorization.creditAddress,
    signature: authorization.signature,
    transaction: authorization.transaction,
  }),
});
const charge = await chargeResponse.json();
if (!chargeResponse.ok || charge.success !== true) {
  return Response.json({ error: "Charge settlement failed" }, { status: 502 });
}

const receipt = Buffer.from(JSON.stringify({
  success: true,
  transaction: charge.signature,
  network: "solana-devnet",
})).toString("base64");
return Response.json(result, {
  headers: { "X-PAYMENT-RESPONSE": receipt, "Cache-Control": "private, no-store" },
});`}</code></pre>
<Link href="/services" className="btn2 integration-register-link">
            Register your service API
          </Link>
        </section>
      </div>
    </div>
  );
}
