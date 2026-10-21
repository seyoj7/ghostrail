import "./page.css";
import Link from "next/link";
import { Nav } from "./components/ui/Nav";

export default function Home() {
  return (
    <div className="pg">
      <div className="in">
        <Nav />

        {/* ── Hero Section ───────────────────────────────────── */}
        <div className="hero-block">
          <div className="mono hero-subtitle-tag">
            x402 facilitator for Solana, devnet
          </div>
          <h1 className="hero-title">
            Payments that settle. Fees that vanish.
          </h1>
          <p className="mut hero-description">
            AI agents and apps pay for APIs in USDC with no SOL needed. Funds sit
            in escrow and refund automatically if the API fails.
          </p>
          <div className="hero-actions">
            <Link href="/dashboard" className="btn">
              Open dashboard
            </Link>
            <Link href="/attack-lab" className="btn2">
              Try the attack lab
            </Link>
          </div>
        </div>

        {/* ── 5-Step Process Flow ────────────────────────────── */}
        <div className="steps-grid">
          <div className="card step-card">
            <div className="mono step-number">1</div>
            <div className="step-title">Request</div>
            <div className="mut step-desc">
              Buyer hits a paid resource and gets a 402 with the price.
            </div>
          </div>

          <div className="card step-card">
            <div className="mono step-number">2</div>
            <div className="step-title">Lock</div>
            <div className="mut step-desc">
              Buyer&apos;s USDC is locked in an on-chain escrow. No SOL needed.
            </div>
          </div>

          <div className="card step-card">
            <div className="mono step-number">3</div>
            <div className="step-title">Verify</div>
            <div className="mut step-desc">
              GHOSTRAIL checks every instruction before anything moves.
            </div>
          </div>

          <div className="card step-card">
            <div className="mono step-number">4</div>
            <div className="step-title">Deliver</div>
            <div className="mut step-desc">
              Seller returns the resource and confirms delivery.
            </div>
          </div>

          <div className="card step-card">
            <div className="mono step-number">5</div>
            <div className="step-title">Release or refund</div>
            <div className="mut step-desc">
              Escrow pays the seller, or returns the funds to the buyer.
            </div>
          </div>
        </div>

        {/* ── Facilitator Online Status Banner ──────────────── */}
        <div className="card status-card">
          <div>
            <div className="ok status-indicator">Facilitator online</div>
            <div className="mut mono status-details">
              network solana:devnet &nbsp; fee payer 7xKp...3mQ2
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div className="balance-amount">1.84 SOL</div>
            <div className="mut balance-label">fee-payer balance</div>
          </div>
        </div>
      </div>
    </div>
  );
}

