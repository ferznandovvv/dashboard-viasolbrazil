import { NextRequest, NextResponse } from "next/server";
import { usarPasse } from "@/lib/acesso/ponteWhats";

export const dynamic = "force-dynamic";

/** A portaria da WA-AKG confere o passe aqui (uso único, 1 minuto). */
export async function GET(req: NextRequest) {
  const t = req.nextUrl.searchParams.get("t") ?? "";
  return NextResponse.json({ ok: Boolean(t) && usarPasse(t) });
}
