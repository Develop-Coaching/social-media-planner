import { NextResponse } from "next/server";
import { isDriveConfigured } from "@/lib/drive";

export async function GET() {
  return NextResponse.json({ configured: isDriveConfigured() });
}
