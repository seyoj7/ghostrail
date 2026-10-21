"use client";

import "./page.css";
import { useState } from "react";
import { Nav } from "../components/ui/Nav";

interface AttackScenario {
  id: string;
  name: string;
  isInitialActive?: boolean;
  status: "Accepted" | "Rejected";
  statusColorClass: "ok" | "bad";
  reason: string;
  description: string;
  checks: { name: string; status: "ok" | "bad" }[];
}

const ATTACK_SCENARIOS: AttackScenario[] = [
  {
    id: "valid",
    name: "Send a valid payment",
    status: "Accepted",
    statusColorClass: "ok",
    reason: "checks: all_passed",
    description:
      "All 7 safety checks passed. The transaction locks exact USDC in the escrow vault with valid parameters. GHOSTRAIL signs as fee-payer and relays to Solana.",
    checks: [
      { name: "programs ok", status: "ok" },
      { name: "mint ok", status: "ok" },
      { name: "amount ok", status: "ok" },
      { name: "recipient ok", status: "ok" },
      { name: "fee payer ok", status: "ok" },
      { name: "escrow ok", status: "ok" },
    ],
  },
  {
    id: "wrong-amount",
    name: "Wrong amount",
    status: "Rejected",
    statusColorClass: "bad",
    reason: "reason: wrong_amount",
    description:
      "The payment locks 0.0005 USDC instead of the required 0.001 USDC invoice price. GHOSTRAIL refuses to sponsor fees or verify the payment.",
    checks: [
      { name: "programs ok", status: "ok" },
      { name: "mint ok", status: "ok" },
      { name: "amount mismatch", status: "bad" },
      { name: "recipient ok", status: "ok" },
      { name: "fee payer ok", status: "ok" },
    ],
  },
  {
    id: "wrong-recipient",
    name: "Wrong recipient",
    status: "Rejected",
    statusColorClass: "bad",
    reason: "reason: wrong_seller",
    description:
      "The escrow lock specifies an unexpected seller recipient address. Funds would not be claimable by the actual merchant, so the facilitator halts verification.",
    checks: [
      { name: "programs ok", status: "ok" },
      { name: "mint ok", status: "ok" },
      { name: "amount ok", status: "ok" },
      { name: "recipient mismatch", status: "bad" },
      { name: "fee payer ok", status: "ok" },
    ],
  },
  {
    id: "wrong-mint",
    name: "Wrong mint",
    status: "Rejected",
    statusColorClass: "bad",
    reason: "reason: wrong_mint",
    description:
      "The token transfer uses a custom spoofed token mint rather than the verified Solana devnet USDC mint (4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU).",
    checks: [
      { name: "programs ok", status: "ok" },
      { name: "mint invalid", status: "bad" },
      { name: "amount ok", status: "ok" },
      { name: "recipient ok", status: "ok" },
      { name: "fee payer ok", status: "ok" },
    ],
  },
  {
    id: "hidden-drain",
    name: "Hidden drain instruction",
    status: "Rejected",
    statusColorClass: "bad",
    reason: "reason: unexpected_instruction",
    description:
      "The transaction contains a transfer that spends from the fee payer. GHOSTRAIL refuses to sign, so nothing is submitted to Solana.",
    checks: [
      { name: "programs ok", status: "ok" },
      { name: "mint ok", status: "ok" },
      { name: "amount ok", status: "ok" },
      { name: "recipient ok", status: "ok" },
      { name: "fee payer unsafe", status: "bad" },
    ],
  },
  {
    id: "replay",
    name: "Replay a payment",
    status: "Rejected",
    statusColorClass: "bad",
    reason: "reason: replayed_signature",
    description:
      "An attacker re-submits a signed transaction that was already verified and settled. The deduplication layer detects the reused signature and immediately halts execution.",
    checks: [
      { name: "programs ok", status: "ok" },
      { name: "mint ok", status: "ok" },
      { name: "amount ok", status: "ok" },
      { name: "recipient ok", status: "ok" },
      { name: "signature replayed", status: "bad" },
    ],
  },
  {
    id: "seller-fails",
    name: "Seller fails after payment",
    status: "Rejected",
    statusColorClass: "bad",
    reason: "reason: delivery_timeout",
    description:
      "Payment was locked in escrow, but the seller API endpoint threw a 500 error and never delivered. After 30 seconds, the escrow contract auto-refunded the buyer in full.",
    checks: [
      { name: "payment locked", status: "ok" },
      { name: "delivery failed", status: "bad" },
      { name: "auto-refund available", status: "ok" },
    ],
  },
];

export default function AttackLabPage() {
  const [selectedScenarioId, setSelectedScenarioId] = useState<string>(
    "hidden-drain" // Default selected in the example screen
  );

  const scenario =
    ATTACK_SCENARIOS.find((s) => s.id === selectedScenarioId) ??
    ATTACK_SCENARIOS[4];

  return (
    <div className="pg">
      <div className="in">
        <Nav />

        <h2 className="attack-lab-heading">Attack lab</h2>
        <p className="mut attack-lab-subtitle">
          Send bad payments and watch them get refused. Devnet only.
        </p>

        <div className="attack-layout">
          {/* ── Attack Actions Column ────────────────────────── */}
          <div className="attack-sidebar">
            {ATTACK_SCENARIOS.map((item) => {
              const isSelected = item.id === selectedScenarioId;
              const buttonClass = isSelected
                ? item.status === "Accepted"
                  ? "btn attack-btn attack-btn--active"
                  : "btn2 attack-btn attack-btn--active"
                : item.id === "valid"
                ? "btn attack-btn"
                : "btn2 attack-btn";

              return (
                <button
                  key={item.id}
                  className={buttonClass}
                  onClick={() => setSelectedScenarioId(item.id)}
                >
                  {item.name}
                </button>
              );
            })}
          </div>

          {/* ── Result Card ──────────────────────────────────── */}
          <div className="card result-card">
            <div className="mut result-tag">Result</div>
            <div className={`${scenario.statusColorClass} result-status`}>
              {scenario.status}
            </div>
            <div className="mono result-reason">{scenario.reason}</div>
            <div className="mut result-desc">{scenario.description}</div>

            <div className="mono mut result-checks-bar">
              checks:{" "}
              {scenario.checks.map((c, i) => (
                <span key={i}>
                  {i > 0 && " · "}
                  <span className={c.status === "bad" ? "bad" : ""}>
                    {c.name}
                  </span>
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
