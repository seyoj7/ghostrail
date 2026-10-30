"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { Nav } from "../components/ui/Nav";
import "./page.css";

type PlaygroundResult = {
  status: number;
  statusText: string;
  body: string;
  receipt: string | null;
};

export default function PlaygroundPage() {
  const [endpoint, setEndpoint] = useState("");
  const [prompt, setPrompt] = useState("Hello from the GHOSTRAIL playground");
  const [payment, setPayment] = useState("");
  const [result, setResult] = useState<PlaygroundResult | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function sendRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setResult(null);

    let parsedEndpoint: URL;
    try {
      parsedEndpoint = new URL(endpoint.trim());
    } catch {
      setError("Enter a valid service endpoint URL.");
      return;
    }
    if (
      parsedEndpoint.protocol !== "https:" &&
      parsedEndpoint.protocol !== "http:"
    ) {
      setError("The endpoint must use HTTP or HTTPS.");
      return;
    }

    setLoading(true);
    try {
      const headers = new Headers({ "Content-Type": "application/json" });
      if (payment.trim()) headers.set("X-PAYMENT", payment.trim());
      const response = await fetch(parsedEndpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({ prompt }),
        cache: "no-store",
      });
      const rawBody = await response.text();
      let body = rawBody;
      try {
        body = JSON.stringify(JSON.parse(rawBody), null, 2);
      } catch {
        // Keep non-JSON service responses readable as plain text.
      }
      setResult({
        status: response.status,
        statusText: response.statusText,
        body,
        receipt: response.headers.get("X-PAYMENT-RESPONSE"),
      });
    } catch (requestError) {
      const message =
        requestError instanceof Error ? requestError.message : String(requestError);
      setError(
        `${message} Check that the endpoint is reachable and allows browser requests with CORS.`,
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="pg">
      <div className="in">
        <Nav />
        <main className="playground-page">
          <header className="playground-header">
            <div className="mono playground-eyebrow">BUYER &amp; SELLER TOOL</div>
            <h1 className="playground-title">x402 Playground</h1>
            <p className="mut playground-intro">
              Inspect an endpoint&apos;s payment challenge or try a paid request
              with a buyer-signed <code>X-PAYMENT</code> header. Sellers can use
              this to check their 402 response; buyers can inspect what an
              endpoint requires.
            </p>
          </header>

          <div className="playground-grid">
            <form className="playground-form" onSubmit={sendRequest}>
              <label className="playground-field">
                <span>Service endpoint</span>
                <input
                  type="url"
                  required
                  placeholder="https://api.example.com"
                  value={endpoint}
                  onChange={(event) => setEndpoint(event.target.value)}
                />
              </label>

              <label className="playground-field">
                <span>Prompt</span>
                <textarea
                  rows={3}
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                />
              </label>

              <label className="playground-field">
                <span>X-PAYMENT value <em>Optional</em></span>
                <textarea
                  rows={4}
                  placeholder="Paste the buyer-signed base64 X-PAYMENT value."
                  value={payment}
                  onChange={(event) => setPayment(event.target.value)}
                  spellCheck={false}
                />
                <small>
                  Without this header, the playground sends an unpaid request
                  and displays the service&apos;s 402 challenge. A paid request
                  may be charged after successful delivery.
                </small>
              </label>

              <button
                className="btn playground-submit"
                type="submit"
                disabled={loading}
              >
                {loading
                  ? "Sending..."
                  : payment.trim()
                    ? "Send paid request"
                    : "Inspect endpoint"}
              </button>

              {error && (
                <p className="playground-error" role="alert">
                  {error}
                </p>
              )}
            </form>

            <section
              className="playground-output"
              aria-labelledby="playground-output-title"
              aria-live="polite"
            >
              <div className="playground-output-heading">
                <h2 id="playground-output-title">Response</h2>
                {result && (
                  <span
                    className={`playground-status${result.status === 402 ? " is-challenge" : ""}`}
                  >
                    {result.status} {result.statusText}
                  </span>
                )}
              </div>
              {result ? (
                <>
                  <pre className="playground-response">
                    {result.body || "(empty response body)"}
                  </pre>
                  {result.receipt && (
                    <div className="playground-receipt">
                      <strong>X-PAYMENT-RESPONSE</strong>
                      <code>{result.receipt}</code>
                    </div>
                  )}
                </>
              ) : (
                <p className="mut playground-placeholder">
                  The endpoint response and any payment receipt will appear here.
                </p>
              )}
            </section>
          </div>

          <aside className="playground-note">
            <p className="mut">
              Need to create a buyer-signed payment? Use the Node.js or Python
              SDK from your own environment so your wallet key stays private.
              Your service must allow <code>Content-Type</code> and{" "}
              <code>X-PAYMENT</code> in CORS, and expose{" "}
              <code>X-PAYMENT-RESPONSE</code> for paid calls.
            </p>
            <Link href="/docs" className="playground-docs-link">
              Read the integration guide
            </Link>
          </aside>
        </main>
      </div>
    </div>
  );
}
