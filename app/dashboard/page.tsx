"use client";

import "./page.css";
import { useEffect, useState, useCallback } from "react";
import { Nav } from "../components/ui/Nav";

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
  const [loadError, setLoadError] = useState(false);

  const fetchRecords = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api");
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          setRecords(data);
          setLoadError(false);
        } else {
          setLoadError(true);
        }
      } else {
        setLoadError(true);
      }
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRecords();
  }, [fetchRecords]);

  const verifiedCount = records.filter((r) => r.accepted).length;
  const rejectedCount = records.filter((r) => !r.accepted).length;

  return (
    <div className="pg">
      <div className="in">
        <Nav />

        <h2 className="dashboard-heading">Dashboard</h2>

        {/* ── 4 Key Stats ───────────────────────────────────── */}
        <div className="stats-row">
          <div className="card stat-card">
            <div className="mut stat-label">Verified</div>
            <div className="ok stat-val">{verifiedCount}</div>
          </div>
          <div className="card stat-card">
            <div className="mut stat-label">Rejected</div>
            <div className="bad stat-val">{rejectedCount}</div>
          </div>
          <div className="card stat-card">
            <div className="mut stat-label">Fees sponsored</div>
            <div className="mut stat-val">Not available</div>
          </div>
          <div className="card stat-card">
            <div className="mut stat-label">Fee-payer balance</div>
            <div className="mut stat-val">Not available</div>
          </div>
        </div>

        {/* ── Recent Payments Table ─────────────────────────── */}
        <div className="card">
          <div className="payments-card-header">
            <div className="payments-title">Recent payments</div>
            <button
              className="refresh-action-btn"
              onClick={fetchRecords}
              disabled={loading}
              title="Refresh payments"
            >
              <span className={loading ? "spinner" : ""}>↻</span>
              Refresh
            </button>
          </div>

          <div className="row mut" style={{ borderTop: 0, fontSize: "13px" }}>
            <span>Time</span>
            <span>Seller</span>
            <span>Amount</span>
            <span>Result</span>
            <span>Transaction</span>
          </div>

          {records.map((record) => {
                const timeStr = new Date(record.createdAt).toLocaleTimeString();
                const isOk = record.accepted;
                const statusLabel = isOk
                  ? record.escrowState
                    ? record.escrowState
                    : "Released"
                  : `Rejected: ${record.rejectionReason ?? "invalid"}`;

                const sigShort = record.signature
                  ? `${record.signature.slice(0, 4)}...${record.signature.slice(
                      -3
                    )}`
                  : "none";

                return (
                  <div className="row" key={record.id}>
                    <span className="mono mut">{timeStr}</span>
                    <span>{record.seller.slice(0, 11)}...</span>
                    <span>{record.amount} USDC</span>
                    <span>
                      <span className={isOk ? "ok" : "bad"}>{statusLabel}</span>
                    </span>
                    <span className="mono tx-hash">
                      {record.signature && record.signature !== "none" ? (
                        <a
                          href={`https://explorer.solana.com/tx/${record.signature}?cluster=devnet`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="tx-hash-link"
                        >
                          {sigShort}
                        </a>
                      ) : (
                        "none"
                      )}
                    </span>
                  </div>
                );
              })}
          {!loading && loadError && (
            <div className="row">Could not load payment records.</div>
          )}
          {!loading && !loadError && records.length === 0 && (
            <div className="row">No payment records yet.</div>
          )}
        </div>
      </div>
    </div>
  );
}

