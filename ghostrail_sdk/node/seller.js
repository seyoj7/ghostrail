const DEFAULT_FACILITATOR_URL = "http://127.0.0.1:3000";

/** Register a seller's service API and devnet USDC price with GHOSTRAIL. */
export class Seller {
  constructor(facilitatorUrl = process.env.FACILITATOR_URL || DEFAULT_FACILITATOR_URL) {
    this.facilitatorUrl = facilitatorUrl.replace(/\/+$/, "");
  }

  async registerService({ serviceName, apiEndpoint, sellerWallet, priceUsdc }) {
    const response = await fetch(`${this.facilitatorUrl}/api/services`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: serviceName,
        endpointUrl: apiEndpoint,
        sellerWallet,
        priceUsdc: String(priceUsdc),
      }),
    });

    let result;
    try {
      result = await response.json();
    } catch {
      throw new Error(`Facilitator returned invalid JSON (HTTP ${response.status})`);
    }
    if (!response.ok) {
      throw new Error(`Service registration failed: ${result.error || `HTTP ${response.status}`}`);
    }
    if (!result || typeof result !== "object" || !result.id) {
      throw new Error("Facilitator returned an invalid service response");
    }
    return result;
  }

  /** Delete a service using the secret returned when it was registered. */
  async deleteService(serviceId, deleteToken) {
    const response = await fetch(
      `${this.facilitatorUrl}/api/services/${encodeURIComponent(serviceId)}`,
      { method: "DELETE", headers: { Authorization: `Bearer ${deleteToken}` } },
    );
    if (response.ok) return;
    let result;
    try {
      result = await response.json();
    } catch {
      result = {};
    }
    throw new Error(`Service deletion failed: ${result.error || `HTTP ${response.status}`}`);
  }
}
