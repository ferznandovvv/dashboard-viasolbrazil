import { NextRequest, NextResponse } from "next/server";
import { lerBase } from "@/lib/crm/base";
import { conferir } from "@/lib/crm/conferencia";

export const dynamic = "force-dynamic";

/** Conferência do cashback manual: desconto sem baixa e baixa sem desconto. */
export async function GET(req: NextRequest) {
  const dias = Math.min(90, Math.max(1, Number(req.nextUrl.searchParams.get("dias")) || 14));
  const loja = req.nextUrl.searchParams.get("loja") || undefined;
  return NextResponse.json(conferir(await lerBase(), dias, loja));
}
