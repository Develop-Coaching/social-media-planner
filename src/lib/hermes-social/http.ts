import { NextResponse } from "next/server";
import { HermesAuthError } from "./auth";
import { HermesRepositoryError } from "./repository";

export function jsonNoStore(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

export function hermesErrorResponse(error: unknown) {
  if (error instanceof HermesAuthError || error instanceof HermesRepositoryError) {
    return jsonNoStore({ error: error.message }, error.status);
  }
  return jsonNoStore({ error: "Hermes schedule request failed" }, 500);
}

export function parseJsonBody(rawBody: Uint8Array): unknown {
  try {
    const value = JSON.parse(new TextDecoder().decode(rawBody));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value;
  } catch {
    throw new HermesRepositoryError("Request body must be a JSON object", 400);
  }
}
