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

function formatUsdc(baseUnits: string): string {
  try {
    const amount = BigInt(baseUnits);
    const scale = BigInt(1_000_000);
    const whole = amount / scale;
    const fraction = (amount % scale)
      .toString()
      .padStart(6, "0")
      .replace(/0+$/, "");
    return fraction ? `${whole}.${fraction}` : whole.toString();
  } catch {
    return baseUnits;
  }
}

export default function DashboardPage() {
  const [records, setRecords] = useState<PaymentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const fetchRecords = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/payments");
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
    const timer = window.setTimeout(() => void fetchRecords(), 0);
    return () => window.clearTimeout(timer);
  }, [fetchRecords]);

  const verifiedCount = records.filter((r) => r.accepted).length;
  const rejectedCount = records.filter((r) => !r.accepted).length;
  const acceptedVolume = records
    .filter((r) => r.accepted)
    .reduce((total, record) => {
      try {
        return total + BigInt(record.amount);
      } catch {
        return total;
      }
    }, BigInt(0))
    .toString();

  return (
    <div className="pg">
      <div className="in">
        <Nav />

        <h2 className="dashboard-heading">Dashboard</h2>

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
            <div className="mut stat-label">Total payments</div>
            <div className="mut stat-val">{records.length}</div>
          </div>
          <div className="card stat-card">
            <div className="mut stat-label">Accepted volume</div>
            <div className="mut stat-val stat-val-volume">
              {formatUsdc(acceptedVolume)} USDC
            </div>
          </div>
        </div>

        <div className="card payments-card">
          <div className="payments-card-header">
            <div className="payments-title">Recent payments</div>
            <button
              className="refresh-action-btn"
              onClick={fetchRecords}
              disabled={loading}
              title="Refresh payments"
            >
              {loading ? (
                <svg
                  className="spinner"
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.8"
                  strokeLinecap="round"
                  aria-hidden="true"
                >
                  <circle cx="12" cy="12" r="9" strokeDasharray="42 16" />
                </svg>
              ) : (
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
                  <polyline points="21 3 21 8 16 8" />
                </svg>
              )}
              Refresh
            </button>
          </div>

          <div className="dashboard-table-header row mut">
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
                : "Verified"
              : `Rejected: ${record.rejectionReason ?? "invalid"}`;

            const sigShort = record.signature
              ? `${record.signature.slice(0, 4)}...${record.signature.slice(
                  -3
                )}`
              : "none";

            const sellerShort = record.seller
              ? `${record.seller.slice(0, 4)}...${record.seller.slice(-3)}`
              : "none";

            return (
              <div className="row payment-record-row" key={record.id}>
                <div className="payment-cell payment-cell-time mono mut">
                  <span className="mobile-meta-label">Time: </span>
                  {timeStr}
                </div>
                <div className="payment-cell payment-cell-seller mono tx-hash">
                  <span className="mobile-meta-label mut">Seller: </span>
                  {record.seller ? (
                    <a
                      href={`https://explorer.solana.com/address/${record.seller}?cluster=devnet`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="tx-hash-link"
                      title={record.seller}
                    >
                      {sellerShort}
                    </a>
                  ) : (
                    "none"
                  )}
                </div>
                <div className="payment-cell payment-cell-amount">
                  <span className="payment-amount-val">
                    {formatUsdc(record.amount)} USDC
                  </span>
                </div>
                <div className="payment-cell payment-cell-status">
                  <span className={`status-pill ${isOk ? "ok" : "bad"}`}>
                    {statusLabel}
                  </span>
                </div>
                <div className="payment-cell payment-cell-tx mono tx-hash">
                  <span className="mobile-meta-label mut">Tx: </span>
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
                  {record.escrowAddress && (
                    <a
                      href={`/playground?refund=${encodeURIComponent(record.escrowAddress)}`}
                      className="tx-hash-link"
                      title={`Refund escrow ${record.escrowAddress}`}
                    >
                      Refund escrow
                    </a>
                  )}
                </div>
              </div>
            );
          })}

          {!loading && loadError && (
            <div className="payment-empty-row mut">
              Could not load payment records.
            </div>
          )}
          {!loading && !loadError && records.length === 0 && (
            <div className="payment-empty-row mut">No payment records yet.</div>
          )}
        </div>
      </div>
    </div>
  );
}
