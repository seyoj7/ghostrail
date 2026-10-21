import "server-only";

import { PublicKey } from "@solana/web3.js";
import { addRegisteredService, getRegisteredServices } from "./db";

const MAX_U64 = BigInt("18446744073709551615");
const USDC_DECIMALS = 6;

export function listServices(): Response {
  return Response.json(getRegisteredServices());
}

export async function registerService(request: Request): Promise<Response> {
  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    return Response.json({ error: "Request body must be valid JSON" }, { status: 400 });
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return Response.json({ error: "Request body must be a JSON object" }, { status: 400 });
  }
  const body = parsed as Record<string, unknown>;

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const endpointUrl = typeof body.endpointUrl === "string" ? body.endpointUrl.trim() : "";
  const sellerWallet = typeof body.sellerWallet === "string" ? body.sellerWallet.trim() : "";
  const priceUsdc = typeof body.priceUsdc === "string" ? body.priceUsdc.trim() : "";

  if (!name || name.length > 80) {
    return Response.json({ error: "Name is required and must be 80 characters or fewer" }, { status: 400 });
  }

  let endpoint: URL;
  try {
    endpoint = new URL(endpointUrl);
  } catch {
    return Response.json({ error: "Enter a valid service URL" }, { status: 400 });
  }
  const isLocalHttp =
    endpoint.protocol === "http:" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(endpoint.hostname);
  if (
    (endpoint.protocol !== "https:" && !isLocalHttp) ||
    endpoint.username ||
    endpoint.password ||
    endpoint.hash
  ) {
    return Response.json(
      { error: "Use an HTTPS URL (HTTP is allowed for localhost development)" },
      { status: 400 }
    );
  }

  try {
    new PublicKey(sellerWallet);
  } catch {
    return Response.json({ error: "Enter a valid Solana seller wallet address" }, { status: 400 });
  }

  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(priceUsdc)) {
    return Response.json(
      { error: "Price must be a positive USDC amount with up to 6 decimal places" },
      { status: 400 }
    );
  }
  const [whole, fraction = ""] = priceUsdc.split(".");
  const amountBaseUnits =
    BigInt(whole) * BigInt(10) ** BigInt(USDC_DECIMALS) +
    BigInt(fraction.padEnd(USDC_DECIMALS, "0"));
  if (amountBaseUnits <= BigInt(0) || amountBaseUnits > MAX_U64) {
    return Response.json({ error: "Price is outside the supported range" }, { status: 400 });
  }

  const service = addRegisteredService({
    name,
    endpointUrl: endpoint.toString(),
    sellerWallet: new PublicKey(sellerWallet).toBase58(),
    priceUsdc,
  });

  return Response.json(service, { status: 201 });
}
