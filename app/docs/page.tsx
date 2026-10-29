import "./page.css";
import { Nav } from "../components/ui/Nav";

export default function DocsPage() {
  return (
    <div className="pg">
      <div className="in">
        <Nav />
        <main className="docs-page">
          <header className="docs-header">
            <div className="mono docs-eyebrow">INTEGRATION GUIDE</div>
            <h1 className="docs-title">Pay from reusable USDC credit</h1>
            <p className="mut docs-intro">
              GHOSTRAIL uses an x402 v1 HTTP challenge with a buyer funded,
              seller bound credit account on Solana devnet. Deposit once, then
              authorize individual service charges from the remaining balance.
            </p>
          </header>

          <section className="docs-section" aria-labelledby="docs-discovery">
            <h2 id="docs-discovery">1. Read the payment challenge</h2>
            <p className="mut">
              Call the resource without <code>X-PAYMENT</code>. The HTTP 402
              response includes the service price and the credit deposit bounds.
              Amounts use six-decimal USDC base units.
            </p>
            <pre className="docs-code"><code>{`{
  "x402Version": 1,
  "accepts": [{
    "scheme": "escrow",
    "network": "solana-devnet",
    "maxAmountRequired": "10000",
    "payTo": "<seller public key>",
    "asset": "<USDC mint>",
    "extra": {
      "escrowProgramId": "<escrow program ID>",
      "creditModel": "prepaid",
      "minDepositAmount": "1000000",
      "maxBalanceAmount": "100000000"
    }
  }]
}`}</code></pre>
            <p className="mut">
              Deposit between 1 and 100 USDC. The buyer/seller/mint combination
              has one deterministic credit account. New deposits can top it up,
              as long as the total balance stays at or below 100 USDC.
            </p>
          </section>

          <section className="docs-section" aria-labelledby="docs-payment">
            <h2 id="docs-payment">2. Deposit once and sign each call</h2>
            <p className="mut">
              The buyer signs <code>deposit_credit</code> to fund the account.
              For each request, the buyer signs a <code>charge_credit</code>
              instruction for the service price and the next on-chain nonce.
              The transaction is sent in the x402 v1 header:
            </p>
            <pre className="docs-code"><code>{`const payment = {
  x402Version: 1,
  scheme: "escrow",
  network: "solana-devnet",
  payload: { transaction: "<base64 buyer-signed charge transaction>" }
};
const xPayment = btoa(JSON.stringify(payment));
const response = await fetch(resourceUrl, {
  method: "POST",
  headers: { "Content-Type": "application/json", "X-PAYMENT": xPayment },
  body: JSON.stringify({ prompt })
});`}</code></pre>
            <p className="mut">
              The seller forwards the header to <code>POST /api</code> with
              either a registered <code>serviceId</code> or explicit seller,
              amount, and mint. GHOSTRAIL checks the buyer signature, exact
              seller and price, credit vault balance, nonce, and replay status.
              This verifies the authorization without charging yet.
            </p>
          </section>

          <section className="docs-section" aria-labelledby="docs-settlement">
            <h2 id="docs-settlement">3. Deliver, then charge</h2>
            <p className="mut">
              Run the handler after verification. If it succeeds, send the
              verified transaction to <code>PUT /api</code> with
              <code> action: &quot;charge&quot;</code>. The facilitator submits
              the buyer-signed transaction and waits for confirmation before
              returning the resource.
            </p>
            <pre className="docs-code"><code>{`const receipt = response.headers.get("X-PAYMENT-RESPONSE");
const settlement = receipt ? JSON.parse(atob(receipt)) : undefined;
// settlement.transaction is the confirmed charge signature.`}</code></pre>
            <p className="mut">
              If the handler fails, do not submit the charge. The balance is
              unchanged. The buyer can withdraw any unused USDC at any time
              with <code>withdraw_credit</code>. Buyers pay devnet SOL fees for
              deposits, charges, and withdrawals.
            </p>
          </section>

          <aside className="docs-callout">
            <strong>Devnet demo</strong>
            <p className="mut">
              The updated Anchor program must be deployed before using prepaid
              credit. GHOSTRAIL is unaudited, and registered services remain
              unverified. Do not use real funds or mainnet.
            </p>
          </aside>
        </main>
      </div>
    </div>
  );
}
