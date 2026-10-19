import { NextRequest, NextResponse } from "next/server";
import { verifyPayment } from "../../backend/verify";
import { releaseEscrow, refundEscrow } from "../../backend/settlement";
import {
  findPaymentBySignature,
  getRecentPayments,
} from "../../backend/db";

/**
 * POST /api — Verify a payment transaction.
 *
 * Body: { transaction: string, seller: string, amount: string, mint: string }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { transaction, seller, amount, mint } = body;

    if (!transaction || !seller || !amount || !mint) {
      return NextResponse.json(
        { error: "Missing required fields: transaction, seller, amount, mint" },
        { status: 400 }
      );
    }

    const result = await verifyPayment(transaction, seller, amount, mint);

    return NextResponse.json(result, {
      status: result.accepted ? 200 : 402,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * PUT /api — Settle an escrow (release or refund).
 *
 * Body: { escrowAddress: string, action: "release" | "refund" }
 */
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { escrowAddress, action } = body;

    if (!escrowAddress || !action) {
      return NextResponse.json(
        { error: "Missing required fields: escrowAddress, action" },
        { status: 400 }
      );
    }

    if (action !== "release" && action !== "refund") {
      return NextResponse.json(
        { error: "action must be 'release' or 'refund'" },
        { status: 400 }
      );
    }

    const result =
      action === "release"
        ? await releaseEscrow(escrowAddress)
        : await refundEscrow(escrowAddress);

    return NextResponse.json(result, {
      status: result.success ? 200 : 400,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * GET /api — Query payment or escrow status.
 *
 * Query params: ?signature=... or ?escrowAddress=...
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const signature = searchParams.get("signature");
    const escrowAddress = searchParams.get("escrowAddress");

    if (signature) {
      const record = findPaymentBySignature(signature);

      if (!record) {
        return NextResponse.json(
          { error: "Payment record not found" },
          { status: 404 }
        );
      }

      return NextResponse.json(record);
    }

    if (escrowAddress) {
      const { fetchEscrow } = await import("../../backend/escrow");
      const escrow = await fetchEscrow(escrowAddress);

      if (!escrow) {
        return NextResponse.json(
          { error: "Escrow account not found" },
          { status: 404 }
        );
      }

      return NextResponse.json(escrow);
    }

    // No params — return recent payments
    const records = getRecentPayments(50);
    return NextResponse.json(records);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
