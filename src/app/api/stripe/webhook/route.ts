import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { addCredits, recordPayment } from "@/lib/credits";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret || !process.env.STRIPE_SECRET_KEY) {
    return NextResponse.json({ error: "Stripe not configured" }, { status: 500 });
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

  let event: Stripe.Event;

  try {
    const body = await request.text();
    const signature = request.headers.get("stripe-signature");

    if (!signature) {
      return NextResponse.json({ error: "Missing signature" }, { status: 400 });
    }

    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (err) {
    console.error("Stripe webhook signature verification failed:", err);
    return NextResponse.json(
      { error: "Invalid signature" },
      { status: 400 }
    );
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;

    const userId = session.metadata?.userId;
    const packageCents = parseInt(session.metadata?.packageCents || "0", 10);

    if (!userId || !packageCents) {
      console.error("Missing metadata in Stripe session:", session.id);
      return NextResponse.json({ received: true });
    }

    try {
      // Add credits to user's balance
      await addCredits(userId, packageCents);

      // Record payment history
      await recordPayment(userId, session.id, packageCents, "completed");
    } catch (err) {
      console.error("Failed to process Stripe payment:", err);
      // Still return 200 to acknowledge receipt (Stripe will retry otherwise)
    }
  }

  return NextResponse.json({ received: true });
}
