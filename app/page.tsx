import "./page.css";
import Link from "next/link";
import { Nav } from "./components/ui/Nav";
import { SdkCodeSnippet } from "./components/ui/SdkCodeSnippet";

export default function Home() {
  return (
    <div className="pg home-page">
      <div className="in">
        <Nav />

        <div className="hero-block">
          <div className="mono hero-subtitle-tag">
            x402 facilitator for Solana
          </div>
          <h1 className="hero-title">
            Payments that settle. <br />
            Fees that vanish.
          </h1>
          <p className="mut hero-description">
            AI agents and apps pay for APIs from devnet USDC credit. Buyers
            deposit once, then sign a nonce-protected charge for each successful
            request. Buyers only need devnet SOL for fees and rent.
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

        {/* ── How It Works Section ───────────────────────────────────── */}
        <section
          className="how-it-works-section"
          aria-labelledby="how-it-works-title"
        >
          <div className="how-it-works-header">
            <div className="mono how-it-works-eyebrow">WORKFLOW &amp; LIFECYCLE</div>
            <h2 className="how-it-works-title" id="how-it-works-title">
              How it works
            </h2>
            <p className="how-it-works-subtitle">
              Deposit once, authorize off-chain with sequential nonces, and
              settle only when API delivery succeeds.
            </p>
          </div>

          <div className="how-it-works-grid">
            <div className="how-step-card">
              <div className="how-step-badge">
                <span className="mono how-step-num">01</span>
                <span className="how-step-tag">DEPOSIT</span>
              </div>
              <h3 className="how-step-title">Deposit USDC credit</h3>
              <p className="how-step-desc">
                Fund an Anchor PDA vault on Solana devnet once. Credit is bound to
                you, the seller, and the token mint. It remains strictly
                non-custodial and withdrawable anytime.
              </p>
              <div className="how-step-footer mono">
                <span>One-time tx</span>
                <span className="how-step-pill">Solana Devnet</span>
              </div>
            </div>

            <div className="how-step-card">
              <div className="how-step-badge">
                <span className="mono how-step-num">02</span>
                <span className="how-step-tag">AUTHORIZE</span>
              </div>
              <h3 className="how-step-title">Sign off-chain nonce</h3>
              <p className="how-step-desc">
                When calling an API, receive an HTTP 402 challenge. Your agent
                signs a charge authorization using the next sequential nonce and
                retries in milliseconds with zero per-call gas fees.
              </p>
              <div className="how-step-footer mono">
                <span>x402 Protocol</span>
                <span className="how-step-pill">Zero Gas</span>
              </div>
            </div>

            <div className="how-step-card">
              <div className="how-step-badge">
                <span className="mono how-step-num">03</span>
                <span className="how-step-tag">SETTLE</span>
              </div>
              <h3 className="how-step-title">Settle on delivery</h3>
              <p className="how-step-desc">
                The seller executes their API handler first. Only when upstream
                data is delivered successfully does the facilitator settle the
                charge on-chain. Failed requests are never charged.
              </p>
              <div className="how-step-footer mono">
                <span>Atomic charge</span>
                <span className="how-step-pill">Fairness Guaranteed</span>
              </div>
            </div>
          </div>
        </section>

        <section
          className="architecture-section"
          aria-labelledby="architecture-title"
        >
          <div className="architecture-header">
            <h2 className="architecture-title" id="architecture-title">
              Security, escrow and control
            </h2>
            <p className="architecture-subtitle">
              Buyer-authorized charges, seller-bound credit, and on-chain checks
              keep payment control with the people involved.
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
                USDC is held in an Anchor credit account for one buyer, seller,
                and mint. The facilitator can submit a charge only with the
                buyer&apos;s signed authorization.
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
              <h3 className="architecture-card-title">
                Fail-closed verification
              </h3>
              <p className="architecture-card-desc">
                Payment transactions are checked for the expected program and
                instruction, buyer signature, seller, amount, mint, account
                addresses, and credit balance before acceptance.
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
              <h3 className="architecture-card-title">
                Replay &amp; signature audit
              </h3>
              <p className="architecture-card-desc">
                Accepted signatures are recorded in PostgreSQL and checked
                against Solana status; each prepaid charge must also use the
                next on-chain nonce.
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
              <h3 className="architecture-card-title">
                Withdraw unused credit
              </h3>
              <p className="architecture-card-desc">
                Buyers can sign a withdrawal for their remaining prepaid USDC. A
                charge is submitted only after the seller&apos;s handler
                succeeds.
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
              <h3 className="architecture-card-title">
                Devnet transaction fees
              </h3>
              <p className="architecture-card-desc">
                Buyers need devnet SOL for transaction fees on deposits,
                charges, and withdrawals. The first deposit may also need rent
                to create the credit and token accounts.
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
              <h3 className="architecture-card-title">
                Nonce-protected charges
              </h3>
              <p className="architecture-card-desc">
                Each credit charge uses the next on-chain nonce and is limited
                to the seller and mint bound when the buyer deposits.
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
            Register your API
          </h2>
          <p className="mut integration-copy">
            Register your API and set its price with the Node.js or Python SDK.
            Add the returned service ID to your x402 challenge. GHOSTRAIL
            verifies each buyer-signed payment; submit the charge only after
            your handler succeeds.
          </p>
          <SdkCodeSnippet />
          <div className="integration-actions">
            <Link href="/services" className="btn2">
              Register your API
            </Link>
            <a
              href="https://github.com/seyoj7/ghostrail/archive/refs/heads/master.zip"
              className="btn2"
              download
            >
              Download SDK
            </a>
          </div>
        </section>

        <footer className="home-footer">
          <span>© Ghostrail</span>
          <span>x402 facilitator for Solana</span>
        </footer>
      </div>
    </div>
  );
}
