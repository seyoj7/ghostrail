import "server-only";

import { findPaymentBySignature, getRecentPayments } from "./db";
import { fetchEscrow } from "./escrow";
import { getServicePaymentRequirements } from "./services";
import { releaseEscrow, refundEscrow } from "./settlement";
import { verifyPayment } from "./verify";

/** Handle POST /api by verifying a payment transaction. */
export async function handlePaymentPost(request: Request): Promise<Response> {
  try {
    const body: unknown = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return Response.json(
        { error: "Request body must be a JSON object" },
        { status: 400 },
      );
    }
    const fields = body as Record<string, unknown>;

    if (typeof fields.transaction !== "string" || !fields.transaction) {
      return Response.json(
        { error: "Missing required field: transaction" },
        { status: 400 },
      );
    }
    const transaction = fields.transaction;

    let seller: string;
    let amount: string;
    let mint: string;

    if (typeof fields.serviceId === "string" && fields.serviceId) {
      // Auto-resolve seller, amount, and mint from the service registry.
      const requirements = await getServicePaymentRequirements(
        fields.serviceId,
      );
      if (!requirements) {
        return Response.json(
          { error: "Service not found" },
          { status: 404 },
        );
      }
      seller = requirements.seller;
      amount = requirements.amount;
      mint = requirements.mint;
    } else if (
      typeof fields.seller === "string" &&
      typeof fields.amount === "string" &&
      typeof fields.mint === "string" &&
      fields.seller &&
      fields.amount &&
      fields.mint
    ) {
      // Manual specification (backwards compatible).
      seller = fields.seller;
      amount = fields.amount;
      mint = fields.mint;
    } else {
      return Response.json(
        {
          error:
            "Provide either serviceId, or seller, amount, and mint",
        },
        { status: 400 },
      );
    }

    const result = await verifyPayment(transaction, seller, amount, mint);
    return Response.json(result, { status: result.accepted ? 200 : 402 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    return Response.json({ error: message }, { status: 500 });
  }
}

/** Handle PUT /api using a buyer- or seller-signed settlement transaction. */
export async function handleSettlementPut(request: Request): Promise<Response> {
  try {
    const body: unknown = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return Response.json(
        { error: "Request body must be a JSON object" },
        { status: 400 },
      );
    }
    const { escrowAddress, action, transaction } = body as Record<
      string,
      unknown
    >;

    if (
      typeof escrowAddress !== "string" ||
      typeof action !== "string" ||
      typeof transaction !== "string" ||
      !escrowAddress ||
      !action ||
      !transaction
    ) {
      return Response.json(
        {
          error: "Missing required fields: escrowAddress, action, transaction",
        },
        { status: 400 },
      );
    }

    if (action !== "release" && action !== "refund") {
      return Response.json(
        { error: "action must be 'release' or 'refund'" },
        { status: 400 },
      );
    }

    const result =
      action === "release"
        ? await releaseEscrow(escrowAddress, transaction)
        : await refundEscrow(escrowAddress, transaction);

    return Response.json(result, { status: result.success ? 200 : 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    return Response.json({ error: message }, { status: 500 });
  }
}

/** Handle GET /api by returning a payment, escrow, or recent payments. */
export async function handleStatusGet(request: Request): Promise<Response> {
  try {
    const { searchParams } = new URL(request.url);
    const signature = searchParams.get("signature");
    const escrowAddress = searchParams.get("escrowAddress");

    if (signature) {
      const record = await findPaymentBySignature(signature);
      if (!record) {
        return Response.json(
          { error: "Payment record not found" },
          { status: 404 },
        );
      }
      return Response.json(record);
    }

    if (escrowAddress) {
      const escrow = await fetchEscrow(escrowAddress);
      if (!escrow) {
        return Response.json(
          { error: "Escrow account not found" },
          { status: 404 },
        );
      }
      return Response.json(escrow);
    }

    return Response.json(await getRecentPayments(50));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    return Response.json({ error: message }, { status: 500 });
  }
}
