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
            <h1 className="docs-title">Pay for an API with x402 escrow</h1>
            <p className="mut docs-intro">
              GHOSTRAIL uses the x402 v1 HTTP headers with a custom escrow
              scheme on Solana devnet. A lock is confirmed before your handler
              runs; the seller releases funds only after the handler succeeds.
            </p>
          </header>

          <section className="docs-section" aria-labelledby="docs-discovery">
            <h2 id="docs-discovery">1. Request the resource</h2>
            <p className="mut">
              Send the normal request without <code>X-PAYMENT</code>. A paid
              endpoint returns HTTP 402 with x402 v1 payment requirements.
              The amount is in USDC base units.
            </p>
            <pre className="docs-code"><code>{`{
  "x402Version": 1,
  "accepts": [{
    "scheme": "escrow",
    "network": "solana-devnet",
    "maxAmountRequired": "10000",
    "resource": "http://127.0.0.1:8080/chat",
    "description": "USDC payment held in GHOSTRAIL escrow",
    "mimeType": "application/json",
    "payTo": "<seller public key>",
    "maxTimeoutSeconds": 300,
    "asset": "<USDC mint>",
    "extra": { "escrowProgramId": "<escrow program ID>" }
  }]
}`}</code></pre>
            <p className="mut">
              x402 names the seller <code>payTo</code>, the token mint{' '}
              <code>asset</code>, and the timeout limit{' '}
              <code>maxTimeoutSeconds</code>. GHOSTRAIL puts the escrow
              program address in <code>extra.escrowProgramId</code>.
            </p>
          </section>

          <section className="docs-section" aria-labelledby="docs-payment">
            <h2 id="docs-payment">2. Sign and send X-PAYMENT</h2>
            <p className="mut">
              Build an Anchor <code>lock</code> transaction using the amount,
              seller, asset, program, and timeout limit from the challenge. The
              buyer signs it and sends the serialized transaction in an x402
              v1 payload. The facilitator submits the signed lock and waits for
              on-chain confirmation.
            </p>
            <pre className="docs-code"><code>{`const payment = {
  x402Version: 1,
  scheme: "escrow",
  network: "solana-devnet",
  payload: { transaction: "<base64 signed Solana transaction>" }
};

const xPayment = btoa(JSON.stringify(payment));
const response = await fetch(resourceUrl, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-PAYMENT": xPayment
  },
  body: JSON.stringify({ prompt })
});`}</code></pre>
            <p className="mut">
              The seller forwards this header to <code>POST /api</code> with
              either <code>serviceId</code> or the expected <code>seller</code>,{' '}
              <code>amount</code>, and <code>mint</code>. The facilitator
              rejects malformed, mismatched, expired, replayed, or unconfirmed
              locks. It checks the funded vault and Locked escrow before the
              handler can run.
            </p>
          </section>

          <section className="docs-section" aria-labelledby="docs-settlement">
            <h2 id="docs-settlement">3. Run, release, and return the result</h2>
            <p className="mut">
              Run the real resource handler only after the facilitator accepts
              the payment with state <code>Locked</code>. If the handler
              succeeds, the seller signs a release and sends it to{' '}
              <code>PUT /api</code>. The response is returned after the release
              is confirmed.
            </p>
            <pre className="docs-code"><code>{`const receipt = response.headers.get("X-PAYMENT-RESPONSE");
// Base64-encoded x402 settlement response, including the release signature.
const settlement = receipt
  ? JSON.parse(atob(receipt))
  : undefined;`}</code></pre>
            <p className="mut">
              The <code>X-PAYMENT-RESPONSE</code> value is a base64-encoded
              settlement receipt. Its <code>transaction</code> field contains
              the confirmed release signature. If the handler fails, do not
              release; the funds stay Locked so the buyer can refund after the
              timeout.
            </p>
          </section>

          <aside className="docs-callout">
            <strong>Devnet demo requirements</strong>
            <p className="mut">
              The buyer needs devnet SOL for transaction fees and rent in this
              flow. GHOSTRAIL is unaudited, and the custom escrow scheme is not
              the built-in x402 exact-transfer SVM scheme. Registered services
              remain unverified.
            </p>
          </aside>
        </main>
      </div>
    </div>
  );
}
