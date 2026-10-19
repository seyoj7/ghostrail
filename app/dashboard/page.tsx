"use client";

import "./page.css";
import Link from "next/link";
import { useEffect, useState, useCallback } from "react";

interface PaymentRecord {
  id: string;
  signature: string;
  buyer: string;
  seller: string;
  amount: string;
  mint: string;
  escrowAddress: string | null;
  escrowState: string | null;
  accepted: boolean;
  rejectionReason: string | null;
  createdAt: string;
  settledAt: string | null;
}

export default function DashboardPage() {
  const [records, setRecords] = useState<PaymentRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchRecords = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api");
      if (res.ok) {
        const data = await res.json();
        setRecords(data);
      }
    } catch {
      // Silently fail — dashboard shows empty state
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRecords();
  }, [fetchRecords]);

  const accepted = records.filter((r) => r.accepted);
  const rejected = records.filter((r) => !r.accepted);
  const locked = records.filter((r) => r.escrowState === "Locked");
  const settled = records.filter(
    (r) => r.escrowState === "Released" || r.escrowState === "Refunded"
  );

  return (
    <>
      {/* ── Nav ──────────────────────────────────────────────── */}
      <nav className="nav">
        <Link href="/" className="nav__logo">
          <span className="gradient-text">GHOSTRAIL</span>
        </Link>
        <div className="nav__links">
          <Link href="/dashboard" className="nav__link">
            Dashboard
          </Link>
        </div>
      </nav>

      <main className="dashboard">
        <div className="dashboard__header">
          <h1 className="dashboard__title">Facilitator Dashboard</h1>
          <p className="dashboard__subtitle">
            Monitor payments, escrows, and verification logs
          </p>
        </div>

        {/* ── Stats ──────────────────────────────────────────── */}
        <div className="stats">
          <div className="stat glass">
            <div className="stat__label">Total Payments</div>
            <div className="stat__value stat__value--purple">
              {records.length}
            </div>
          </div>
          <div className="stat glass">
            <div className="stat__label">Accepted</div>
            <div className="stat__value stat__value--green">
              {accepted.length}
            </div>
          </div>
          <div className="stat glass">
            <div className="stat__label">Rejected</div>
            <div className="stat__value stat__value--red">
              {rejected.length}
            </div>
          </div>
          <div className="stat glass">
            <div className="stat__label">Active Escrows</div>
            <div className="stat__value stat__value--cyan">
              {locked.length}
            </div>
          </div>
        </div>

        {/* ── Payment History ────────────────────────────────── */}
        <div className="table-section">
          <div className="table-section__title">
            📋 Payment History
            <button
              className="refresh-btn"
              onClick={fetchRecords}
              disabled={loading}
            >
              <span className={loading ? "refresh-btn--spinning" : ""}>↻</span>
              Refresh
            </button>
          </div>

          <div className="table-wrap glass">
            {records.length === 0 ? (
              <div className="empty">
                <div className="empty__icon">🔍</div>
                <p className="empty__text">
                  {loading
                    ? "Loading payments…"
                    : "No payments yet. Run the demo to see activity here."}
                </p>
              </div>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Status</th>
                    <th>Signature</th>
                    <th>Buyer</th>
                    <th>Seller</th>
                    <th>Amount</th>
                    <th>Escrow</th>
                    <th>Time</th>
                  </tr>
                </thead>
                <tbody>
                  {records.map((r) => (
                    <tr key={r.id}>
                      <td>
                        {r.accepted ? (
                          <span className="badge badge--green">✓ Accepted</span>
                        ) : (
                          <span className="badge badge--red">
                            ✗ {r.rejectionReason ?? "Rejected"}
                          </span>
                        )}
                      </td>
                      <td>
                        <span className="truncate mono">{r.signature}</span>
                      </td>
                      <td>
                        <span className="truncate mono">{r.buyer}</span>
                      </td>
                      <td>
                        <span className="truncate mono">{r.seller}</span>
                      </td>
                      <td className="mono">{r.amount}</td>
                      <td>
                        {r.escrowState ? (
                          <span
                            className={`badge ${
                              r.escrowState === "Locked"
                                ? "badge--yellow"
                                : r.escrowState === "Released"
                                ? "badge--green"
                                : "badge--red"
                            }`}
                          >
                            {r.escrowState}
                          </span>
                        ) : (
                          <span className="badge badge--purple">—</span>
                        )}
                      </td>
                      <td>
                        {new Date(r.createdAt).toLocaleTimeString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </main>
    </>
  );
}
