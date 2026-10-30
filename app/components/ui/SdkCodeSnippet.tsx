"use client";

import { useState } from "react";

const snippets = {
  "Node.js": `import { Seller } from "ghosrail-sdk/seller";

const service = await new Seller().registerService({
  serviceName: "My API",
  apiEndpoint: "https://api.example.com",
  sellerWallet: process.env.SELLER_WALLET,
  priceUsdc: "0.01",
});

console.log("Use this service ID in your x402 challenge:", service.id);
// Keep service.deleteToken private.`,
  Python: `from ghostrail_sdk.python.seller import Seller

service = Seller().register_service(
    service_name="My API",
    api_endpoint="https://api.example.com",
    seller_wallet="<SELLER_WALLET>",
    price_usdc="0.01",
)

print("Use this service ID in your x402 challenge:", service["id"])
# Keep service["deleteToken"] private.`,
};

type Language = keyof typeof snippets;

export function SdkCodeSnippet() {
  const [language, setLanguage] = useState<Language>("Node.js");

  return (
    <div className="integration-code-wrap">
      <div className="integration-code-toolbar" role="group" aria-label="SDK language">
        {(Object.keys(snippets) as Language[]).map((option) => (
          <button
            key={option}
            className={`integration-code-toggle${language === option ? " is-active" : ""}`}
            type="button"
            aria-pressed={language === option}
            onClick={() => setLanguage(option)}
          >
            {option}
          </button>
        ))}
      </div>
      <pre className="integration-code">
        <code>{snippets[language]}</code>
      </pre>
    </div>
  );
}
