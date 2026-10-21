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
            <Link href="/services" className="btn2">
              Register a service
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

        <section
          className="card integration-card"
          aria-labelledby="seller-integration-title"
        >
          <div className="mono integration-eyebrow">SELLER INTEGRATION</div>
          <h2 className="integration-title" id="seller-integration-title">
            Register your API, integrate verification
          </h2>
          <p className="mut integration-copy">
            First register your endpoint, seller wallet, and price on the Services
            page. Registration does not connect your API automatically. From your
            server, send the buyer&apos;s base64 signed transaction to the facilitator
            for validation. This endpoint does not submit the transaction or confirm
            settlement; confirm payment on-chain before delivering the resource.
            <code>amount</code> is in token base units.
          </p>
          <pre className="integration-code"><code>{`const response = await fetch(FACILITATOR_URL + "/api", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ transaction, seller, amount, mint }),
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

