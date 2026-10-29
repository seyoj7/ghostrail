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
            Return an x402 HTTP 402 challenge when a request has no
            X-PAYMENT header. The buyer deposits reusable credit once, then
            sends a buyer-signed charge authorization for each call. Verify it
            with the facilitator, run the handler, and submit the charge only
            after success.
          </p>
          <pre className="integration-code"><code>{`// 1. Request your resource and read the HTTP 402 x402 requirements
const challenge = await fetch(resourceUrl, { method: "POST", body });
const { accepts } = await challenge.json();
const requirement = accepts[0];

// 2. Deposit credit once, then sign a charge for this call and its nonce
const transaction = await signCreditCharge(requirement, nextNonce);
const xPayment = btoa(JSON.stringify({
  x402Version: 1,
  scheme: "escrow",
  network: "solana-devnet",
  payload: { transaction },
}));

// 3. Retry; the service forwards X-PAYMENT to GHOSTRAIL
const response = await fetch(resourceUrl, {
  method: "POST",
  headers: { "Content-Type": "application/json", "X-PAYMENT": xPayment },
  body,
});
if (!response.ok) throw new Error("Payment or resource request failed");
const settlement = JSON.parse(atob(response.headers.get("X-PAYMENT-RESPONSE")));`}</code></pre>
<Link href="/services" className="btn2 integration-register-link">
            Register your service API
          </Link>
        </section>
      </div>
    </div>
  );
}
