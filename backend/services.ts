import "server-only";

import { PublicKey } from "@solana/web3.js";
import {
  addRegisteredService,
  findServiceById,
  getRegisteredServices,
} from "./db";
import type { ServicePaymentRequirements } from "../types/payment";

const MAX_U64 = BigInt("18446744073709551615");
const USDC_DECIMALS = 6;
const USDC_BASE = BigInt(10) ** BigInt(USDC_DECIMALS);
const USDC_MINT = process.env.USDC_MINT!;

/** Convert a human-readable USDC price (e.g. "0.01") to token base units (e.g. "10000"). */
export function usdcToBaseUnits(priceUsdc: string): string {
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(priceUsdc)) {
    throw new RangeError(
      "Price must be a positive USDC amount with up to 6 decimal places",
    );
  }
  const [whole, fraction = ""] = priceUsdc.split(".");
  const amount =
    BigInt(whole) * USDC_BASE + BigInt(fraction.padEnd(USDC_DECIMALS, "0"));
  if (amount <= BigInt(0) || amount > MAX_U64) {
    throw new RangeError("Price is outside the supported USDC amount range");
  }
  return amount.toString();
}

/** Look up a registered service and return its payment requirements in base units. */
export async function getServicePaymentRequirements(
  serviceId: string,
): Promise<ServicePaymentRequirements | null> {
  const service = await findServiceById(serviceId);
  if (!service) return null;
  return {
    serviceId: service.id,
    name: service.name,
    seller: service.sellerWallet,
    amount: usdcToBaseUnits(service.priceUsdc),
    mint: USDC_MINT,
    endpointUrl: service.endpointUrl,
  };
}

/** Handle GET /api/services/:id — return service details with payment requirements. */
export async function getServiceById(serviceId: string): Promise<Response> {
  const service = await findServiceById(serviceId);
  if (!service) {
    return Response.json({ error: "Service not found" }, { status: 404 });
  }
  return Response.json({
    ...service,
    paymentRequirements: {
      seller: service.sellerWallet,
      amount: usdcToBaseUnits(service.priceUsdc),
      mint: USDC_MINT,
    },
  });
}

export async function listServices(): Promise<Response> {
  return Response.json(await getRegisteredServices());
}

export async function registerService(request: Request): Promise<Response> {
  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    return Response.json(
      { error: "Request body must be valid JSON" },
      { status: 400 },
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return Response.json(
      { error: "Request body must be a JSON object" },
      { status: 400 },
    );
  }
  const body = parsed as Record<string, unknown>;

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const endpointUrl =
    typeof body.endpointUrl === "string" ? body.endpointUrl.trim() : "";
  const sellerWallet =
    typeof body.sellerWallet === "string" ? body.sellerWallet.trim() : "";
  const priceUsdc =
    typeof body.priceUsdc === "string" ? body.priceUsdc.trim() : "";

  if (!name || name.length > 80) {
    return Response.json(
      { error: "Name is required and must be 80 characters or fewer" },
      { status: 400 },
    );
  }

  let endpoint: URL;
  try {
    endpoint = new URL(endpointUrl);
  } catch {
    return Response.json(
      { error: "Enter a valid service URL" },
      { status: 400 },
    );
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
      { status: 400 },
    );
  }

  try {
    new PublicKey(sellerWallet);
  } catch {
    return Response.json(
      { error: "Enter a valid Solana seller wallet address" },
      { status: 400 },
    );
  }

  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(priceUsdc)) {
    return Response.json(
      {
        error:
          "Price must be a positive USDC amount with up to 6 decimal places",
      },
      { status: 400 },
    );
  }
  const [whole, fraction = ""] = priceUsdc.split(".");
  const amountBaseUnits =
    BigInt(whole) * USDC_BASE + BigInt(fraction.padEnd(USDC_DECIMALS, "0"));
  if (amountBaseUnits <= BigInt(0) || amountBaseUnits > MAX_U64) {
    return Response.json(
      { error: "Price is outside the supported range" },
      { status: 400 },
    );
  }

  const service = await addRegisteredService({
    name,
    endpointUrl: endpoint.toString(),
    sellerWallet: new PublicKey(sellerWallet).toBase58(),
    priceUsdc,
  });

  return Response.json(service, { status: 201 });
}
