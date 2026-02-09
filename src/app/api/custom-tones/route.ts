import { NextRequest, NextResponse } from "next/server";
import { getCustomTones, addCustomTone, deleteCustomTone } from "@/lib/custom-tones";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const companyId = searchParams.get("companyId");

    if (!companyId) {
      return NextResponse.json(
        { error: "companyId is required" },
        { status: 400 }
      );
    }

    const tones = await getCustomTones(companyId);
    return NextResponse.json({ tones });
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: "Failed to load custom tones" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { companyId, label, prompt } = body as {
      companyId?: string;
      label?: string;
      prompt?: string;
    };

    if (!companyId) {
      return NextResponse.json(
        { error: "companyId is required" },
        { status: 400 }
      );
    }

    if (!label || !prompt) {
      return NextResponse.json(
        { error: "label and prompt are required" },
        { status: 400 }
      );
    }

    const tone = await addCustomTone(companyId, label, prompt);
    return NextResponse.json(tone);
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: "Failed to create custom tone" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const companyId = searchParams.get("companyId");
    const id = searchParams.get("id");

    if (!companyId || !id) {
      return NextResponse.json(
        { error: "companyId and id are required" },
        { status: 400 }
      );
    }

    const deleted = await deleteCustomTone(companyId, id);

    if (!deleted) {
      return NextResponse.json(
        { error: "Custom tone not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: "Failed to delete custom tone" },
      { status: 500 }
    );
  }
}
