import "./page.css";
import { Nav } from "../components/ui/Nav";

export default function EscrowPage() {
  return (
    <div className="pg">
      <div className="in">
        <Nav />

        <h2 className="escrow-heading">Payment timeline</h2>
        <p className="mut escrow-subtitle">
          Funds are locked on Solana until the seller delivers. If they do not,
          the buyer is refunded.
        </p>

        <div className="timeline-columns">
          {/* ── Scenario 1: Delivery succeeds ──────────────── */}
          <div className="card timeline-card">
            <div className="ok timeline-card-header">Delivery succeeds</div>

            <div className="timeline-step">
              <div className="timeline-step-title">1. Locked</div>
              <div className="mono mut timeline-step-meta">
                escrow 3Hq...x9 holds 0.001 USDC
              </div>
            </div>

            <div className="timeline-step">
              <div className="timeline-step-title">2. Delivered</div>
              <div className="mono mut timeline-step-meta">
                seller confirmed at 12:04:11
              </div>
            </div>

            <div className="timeline-step">
              <div className="timeline-step-title ok">3. Released</div>
              <div className="mono mut timeline-step-meta">
                0.001 USDC to seller, tx 5kF2...9aQ
              </div>
            </div>
          </div>

          {/* ── Scenario 2: Seller fails ───────────────────── */}
          <div className="card timeline-card">
            <div className="bad timeline-card-header">Seller fails</div>

            <div className="timeline-step">
              <div className="timeline-step-title">1. Locked</div>
              <div className="mono mut timeline-step-meta">
                escrow 8Rw...b2 holds 0.001 USDC
              </div>
            </div>

            <div className="timeline-step">
              <div className="timeline-step-title">2. Timed out</div>
              <div className="mono mut timeline-step-meta">
                no delivery within 30 seconds
              </div>
            </div>

            <div className="timeline-step">
              <div className="timeline-step-title ok">3. Refunded</div>
              <div className="mono mut timeline-step-meta">
                0.001 USDC back to buyer, tx 9Zt1...cL4
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
