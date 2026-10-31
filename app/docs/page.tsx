import Link from "next/link";
import { Nav } from "../components/ui/Nav";
import "./page.css";

const challengeExample = `{
  "x402Version": 1,
  "accepts": [{
    "scheme": "escrow",
    "network": "solana-devnet",
    "maxAmountRequired": "10000",
    "payTo": "<seller public key>",
    "asset": "<devnet USDC mint>",
    "extra": {
      "creditModel": "prepaid",
      "escrowProgramId": "<program ID>",
      "serviceId": "<registered-service-id>"
    }
  }]
}`;

const buyerExample = `import { Ghostrail } from "ghosrail-sdk";

const buyer = new Ghostrail();
const result = await buyer.callService(
  process.env.BUYER_PRIVATE_KEY,
  "https://api.example.com/chat",
  "Summarize this report.",
);

console.log(result.response);
console.log("Confirmed charge:", result.transaction);`;

const sellerExample = `import { Seller } from "ghosrail-sdk/seller";

const service = await new Seller().registerService({
  serviceName: "My API",
  apiEndpoint: "https://api.example.com/chat",
  sellerWallet: process.env.SELLER_WALLET,
  priceUsdc: "0.01",
});

console.log("Service ID:", service.id);
// Store service.deleteToken securely.`;

const verifyExample = `const verification = await fetch(\`\${FACILITATOR_URL}/api\`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-PAYMENT": request.headers.get("X-PAYMENT") ?? "",
  },
  body: JSON.stringify({ serviceId: "<registered-service-id>" }),
});

const payment = await verification.json();
if (!verification.ok || payment.accepted !== true) {
  return Response.json({ error: "Payment was not accepted" }, { status: 402 });
}
// Continue only after checking the verification result.`;

const settleExample = `const settlement = await fetch(\`\${FACILITATOR_URL}/api\`, {
  method: "PUT",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    action: "charge",
    creditAddress: payment.creditAddress,
    signature: payment.signature,
    transaction: payment.transaction,
  }),
});

const charge = await settlement.json();
if (!settlement.ok || charge.success !== true) {
  throw new Error("Charge could not be confirmed");
}

const receipt = Buffer.from(JSON.stringify({
  success: true,
  network: "solana-devnet",
  transaction: charge.signature,
})).toString("base64");

return Response.json(
  { response: serviceResult, payment: { accepted: true }, charge },
  { headers: { "X-PAYMENT-RESPONSE": receipt } },
);`;

export default function DocsPage() {
  return (
    <div className="pg">
      <div className="in">
        <Nav />
        <main className="docs-page">
          <div className="docs-layout">
            <aside className="docs-sidebar" aria-label="On this page">
              <div className="docs-sidebar-title">ON THIS PAGE</div>
              <a href="#overview">Payment flow</a>
              <a href="#buyer">For buyers</a>
              <a href="#seller">For sellers</a>
              <a href="#challenge">Challenge format</a>
              <a href="#limits">Network and limits</a>
              <Link href="/playground">Open playground <span aria-hidden="true">↗</span></Link>
            </aside>

            <article className="docs-content">
              <header className="docs-header">
                <div className="mono docs-eyebrow">DOCUMENTATION / INTEGRATION</div>
                <h1 className="docs-title">Accept and make API payments</h1>
                <p className="mut docs-intro">
                  Integrate x402 payments with reusable USDC credit on Solana devnet.
                  Buyers fund a credit account once; each request is authorized by
                  the buyer and charged only after the service succeeds.
                </p>
                <div className="docs-meta" aria-label="Guide details">
                  <span><i className="docs-meta-dot" /> Solana devnet</span>
                  <span>x402 v1</span>
                  <span>Node.js and Python SDKs</span>
                </div>
              </header>

              <section className="docs-section docs-overview" id="overview">
                <div className="docs-section-kicker">THE FLOW</div>
                <h2>One authorization. A charge after delivery.</h2>
                <p className="mut">
                  The buyer signs a charge for the seller, price, and next nonce.
                  The seller verifies it with the facilitator, runs the service,
                  then submits the charge after successful delivery.
                </p>
                <ol className="docs-flow">
                  <li><span>01</span><div><strong>Challenge</strong><small>The service returns HTTP 402 with its payment terms.</small></div></li>
                  <li><span>02</span><div><strong>Authorize</strong><small>The buyer signs a charge using available prepaid credit.</small></div></li>
                  <li><span>03</span><div><strong>Deliver</strong><small>The seller verifies payment and runs the requested work.</small></div></li>
                  <li><span>04</span><div><strong>Settle</strong><small>The facilitator confirms the charge after the handler succeeds.</small></div></li>
                </ol>
              </section>

              <section className="docs-section" id="buyer">
                <div className="docs-section-kicker">BUYER GUIDE</div>
                <h2>Call a paid service with the SDK</h2>
                <p className="mut">
                  The buyer SDK reads the HTTP 402 challenge, checks the service
                  terms against its configured devnet mint and program, signs a
                  charge, and retries the request. It returns the service
                  response and confirmed transaction receipt.
                </p>
                <pre className="docs-code"><code>{buyerExample}</code></pre>
                <div className="docs-tip">
                  <strong>Before the first paid call</strong>
                  <p className="mut">
                    Deposit devnet USDC for the seller using the buyer SDK. The
                    buyer wallet also needs devnet SOL for transaction fees and
                    account rent. Keep the private key in your own server or
                    agent environment; never place it in browser code.
                  </p>
                </div>
              </section>

              <section className="docs-section" id="seller">
                <div className="docs-section-kicker">SELLER GUIDE</div>
                <h2>Verify, deliver, then settle</h2>
                <p className="mut">
                  Register your service and price with the Seller SDK. Your API
                  should return a 402 challenge when the request has no payment.
                  When it receives <code>X-PAYMENT</code>, forward the header to
                  <code> POST /api</code> with the registered <code>serviceId</code>.
                  The facilitator checks the buyer signature, seller, amount,
                  mint, balance, nonce, and replay status without charging yet.
                </p>
                <pre className="docs-code"><code>{sellerExample}</code></pre>
                <pre className="docs-code"><code>{verifyExample}</code></pre>
                <p className="mut">
                  If verification succeeds, run your handler. If it fails, do
                  not deliver the paid resource. After a successful handler,
                  send the verified <code>creditAddress</code>, <code>signature</code>,
                  and signed <code>transaction</code> to <code>PUT /api</code> with
                  <code> action: "charge"</code>.
                </p>
                <pre className="docs-code"><code>{settleExample}</code></pre>
                <p className="mut">
                  Return the service result together with the payment and charge
                  status. Set <code>X-PAYMENT-RESPONSE</code> to the base64 encoded
                  receipt so buyer clients can verify the confirmed transaction.
                  If your handler fails, do not submit the charge.
                </p>
              </section>

              <section className="docs-section" id="challenge">
                <div className="docs-section-kicker">HTTP 402</div>
                <h2>Publish clear payment terms</h2>
                <p className="mut">
                  Return an x402 v1 challenge from your service endpoint. Amounts
                  are integer USDC base units (six decimal places); for example,
                  <code> "10000"</code> represents 0.01 USDC.
                </p>
                <pre className="docs-code"><code>{challengeExample}</code></pre>
                <p className="mut">
                  Use the registered seller wallet, configured devnet USDC mint,
                  and escrow program ID. Keep the quoted amount consistent with
                  the price used when verifying the service payment.
                </p>
              </section>

              <section className="docs-section" id="limits">
                <div className="docs-section-kicker">ENVIRONMENT</div>
                <h2>Devnet requirements and limits</h2>
                <div className="docs-facts">
                  <div><strong>Network</strong><span>Solana devnet only</span></div>
                  <div><strong>Deposit</strong><span>1–100 USDC per credit account</span></div>
                  <div><strong>Account</strong><span>Bound to buyer, seller, and mint</span></div>
                  <div><strong>Settlement</strong><span>Buyer pays devnet SOL fees</span></div>
                </div>
                <p className="mut docs-limit-note">
                  This deployment and its Anchor program are unaudited and for
                  devnet experimentation only. Service registrations are
                  provided by their owners and are not independently verified.
                  Do not use mainnet funds.
                </p>
              </section>

              <div className="docs-next">
                <div>
                  <span className="docs-section-kicker">READY TO TRY IT?</span>
                  <strong>Inspect a service response in the playground.</strong>
                </div>
                <Link href="/playground" className="btn">Open playground <span aria-hidden="true">→</span></Link>
              </div>
            </article>
          </div>
        </main>
      </div>
    </div>
  );
}
