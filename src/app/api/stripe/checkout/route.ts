import { NextRequest, NextResponse } from "next/server";
import { requireAuth, AuthError } from "@/lib/auth-helpers";
import { isCreditsEnabled, CREDIT_PACKAGES } from "@/lib/pricing";
import Stripe from "stripe";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!isCreditsEnabled()) {
    return NextResponse.json({ error: "Credits system not configured" }, { status: 400 });
  }

  try {
    const { userId } = await requireAuth();
    const { packageCents } = (await request.json()) as { packageCents: number };

    // Validate package amount
    const validPackage = CREDIT_PACKAGES.find((p) => p.cents === packageCents);
    if (!validPackage) {
      return NextResponse.json({ error: "Invalid package amount" }, { status: 400 });
    }

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin;

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: `Post Creator Credits — ${validPackage.label}`,
              description: `${validPackage.label} credit top-up for AI content generation`,
            },
            unit_amount: packageCents,
          },
          quantity: 1,
        },
      ],
      metadata: {
        userId,
        packageCents: String(packageCents),
      },
      success_url: `${appUrl}/billing?success=true`,
      cancel_url: `${appUrl}/billing?canceled=true`,
    });

    return NextResponse.json({ url: session.url });
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error("Stripe checkout error:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to create checkout session" },
      { status: 500 }
    );
  }
}
