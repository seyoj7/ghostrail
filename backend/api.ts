import "server-only";

import { findPaymentBySignature, getRecentPayments } from "./db";
import { fetchEscrow } from "./escrow";
import { releaseEscrow, refundEscrow } from "./settlement";
import { verifyPayment } from "./verify";

/** Handle POST /api by verifying a payment transaction. */
export async function handlePaymentPost(request: Request): Promise<Response> {
  try {
    const body = await request.json();
    const { transaction, seller, amount, mint } = body;

    if (!transaction || !seller || !amount || !mint) {
      return Response.json(
        { error: "Missing required fields: transaction, seller, amount, mint" },
        { status: 400 }
      );
    }

    const result = await verifyPayment(transaction, seller, amount, mint);
    return Response.json(result, { status: result.accepted ? 200 : 402 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    return Response.json({ error: message }, { status: 500 });
  }
}

/** Handle PUT /api by releasing or refunding an escrow. */
export async function handleSettlementPut(request: Request): Promise<Response> {
  try {
    const body = await request.json();
    const { escrowAddress, action } = body;

    if (!escrowAddress || !action) {
      return Response.json(
        { error: "Missing required fields: escrowAddress, action" },
        { status: 400 }
      );
    }

    if (action !== "release" && action !== "refund") {
      return Response.json(
        { error: "action must be 'release' or 'refund'" },
        { status: 400 }
      );
    }

    const result =
      action === "release"
        ? await releaseEscrow(escrowAddress)
        : await refundEscrow(escrowAddress);

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
          { status: 404 }
        );
      }

      return Response.json(record);
    }

    if (escrowAddress) {
      const escrow = await fetchEscrow(escrowAddress);

      if (!escrow) {
        return Response.json(
          { error: "Escrow account not found" },
          { status: 404 }
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
