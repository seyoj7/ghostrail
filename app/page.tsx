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
            AI agents and apps pay for APIs in USDC with no SOL needed. Prices
            are auto-resolved from the service registry — no manual amount
            entry. Funds sit in escrow and the buyer can refund after the
            timeout if the API fails.
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
              <h3 className="architecture-card-title">Non-custodial escrow</h3>
              <p className="architecture-card-desc">
                USDC is locked directly in an on-chain Anchor program PDA. Neither the facilitator nor the fee-payer ever holds custody or authority over escrowed funds.
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
              <h3 className="architecture-card-title">Guaranteed timeout refunds</h3>
              <p className="architecture-card-desc">
                If an API fails or the timeout expires, buyers can independently reclaim 100% of their escrowed funds directly on-chain without seller or facilitator permission.
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
              <h3 className="architecture-card-title">Zero SOL requirements</h3>
              <p className="architecture-card-desc">
                AI agents and client applications pay exclusively in devnet USDC. Transaction fees are sponsored without granting any spending authority.
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
              <h3 className="architecture-card-title">Three-state deterministic lifecycle</h3>
              <p className="architecture-card-desc">
                Escrows operate strictly across Locked, Released, and Refunded states. No unauthorized transitions, intermediate states, or backdoor withdrawals.
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
            Register your endpoint, seller wallet, and price on the Services page.
            Buyers discover your price automatically via the service ID — no manual
            amount entry needed. Send the buyer&apos;s signed transaction to the
            facilitator, then confirm payment on-chain before delivery.
          </p>
          <pre className="integration-code"><code>{`// 1. Discover the service price and payment requirements
const svc = await fetch(FACILITATOR_URL + "/api/services/" + serviceId);
const { paymentRequirements } = await svc.json();
// paymentRequirements → { seller, amount, mint }

// 2. Build and sign the escrow lock transaction using the requirements
// ...

// 3. Verify — price is auto-resolved from the service registry
const response = await fetch(FACILITATOR_URL + "/api", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ transaction, serviceId }),
});
const payment = await response.json();
if (!response.ok || payment.accepted !== true) throw new Error("Payment rejected");
// Continue only after your on-chain settlement check succeeds.`}</code></pre>
<Link href="/services" className="btn2 integration-register-link">
            Register your service API
          </Link>
        </section>
      </div>
    </div>
  );
}
