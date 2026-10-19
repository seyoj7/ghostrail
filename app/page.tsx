import "./page.css";
import Link from "next/link";

export default function Home() {
  return (
    <>
      {/* ── Nav ──────────────────────────────────────────────── */}
      <nav className="nav">
        <div className="nav__logo">
          <span className="gradient-text">GHOSTRAIL</span>
        </div>
        <div className="nav__links">
          <Link href="/dashboard" className="nav__link">
            Dashboard
          </Link>
          <a
            href="https://github.com"
            target="_blank"
            rel="noopener noreferrer"
            className="nav__link"
          >
            GitHub
          </a>
        </div>
      </nav>

      {/* ── Hero ─────────────────────────────────────────────── */}
      <section className="hero">
        <div className="hero__content">
          <span className="hero__badge">Solana Devnet · x402 Protocol</span>

          <h1 className="hero__title">
            <span className="gradient-text">Payments that</span>
            <br />
            protect both sides
          </h1>

          <p className="hero__subtitle">
            GHOSTRAIL is a self-hosted x402 payment facilitator. AI agents pay
            for APIs in USDC — funds are held in on-chain escrow and released
            only after delivery. Failed calls refund automatically.
          </p>

          {/* Flow */}
          <div className="flow">
            <span className="flow__step glass">🤖 Agent pays</span>
            <span className="flow__arrow">→</span>
            <span className="flow__step glass">🔒 Escrow locks</span>
            <span className="flow__arrow">→</span>
            <span className="flow__step glass">✅ API delivers</span>
            <span className="flow__arrow">→</span>
            <span className="flow__step glass">💰 Seller paid</span>
          </div>

          <div className="cta-row">
            <Link href="/dashboard" className="btn btn--primary">
              Open Dashboard →
            </Link>
            <a href="#features" className="btn btn--ghost">
              How it works
            </a>
          </div>
        </div>

        {/* ── Features ───────────────────────────────────────── */}
        <div className="features" id="features">
          <div className="feature glass glass-hover">
            <span className="feature__icon">🔐</span>
            <h3 className="feature__title">On-Chain Escrow</h3>
            <p className="feature__desc">
              USDC is locked in a program-controlled vault — not the
              facilitator, not the seller. Three states only: Locked, Released,
              Refunded.
            </p>
          </div>

          <div className="feature glass glass-hover">
            <span className="feature__icon">⛽</span>
            <h3 className="feature__title">Zero SOL Needed</h3>
            <p className="feature__desc">
              A dedicated fee-payer covers transaction fees. Buyers and agents
              only need USDC — no SOL in their wallet required.
            </p>
          </div>

          <div className="feature glass glass-hover">
            <span className="feature__icon">🛡️</span>
            <h3 className="feature__title">7-Check Verification</h3>
            <p className="feature__desc">
              Every payment goes through 7 independent checks: program
              allowlist, amounts, replay protection, timeout bounds, and more.
            </p>
          </div>

          <div className="feature glass glass-hover">
            <span className="feature__icon">↩️</span>
            <h3 className="feature__title">Automatic Refunds</h3>
            <p className="feature__desc">
              If the API fails or times out, the buyer reclaims funds
              automatically. No dispute process, no middleman.
            </p>
          </div>

          <div className="feature glass glass-hover">
            <span className="feature__icon">🤖</span>
            <h3 className="feature__title">Agent-First</h3>
            <p className="feature__desc">
              Built for AI agents using the x402 protocol. Standard HTTP 402 +
              payment headers — any x402 client works out of the box.
            </p>
          </div>

          <div className="feature glass glass-hover">
            <span className="feature__icon">📊</span>
            <h3 className="feature__title">Live Dashboard</h3>
            <p className="feature__desc">
              Monitor active escrows, payment history, verification logs, and
              wallet balances in real time.
            </p>
          </div>
        </div>
      </section>
    </>
  );
}
