import { NextResponse } from "next/server";
import { lerBase } from "@/lib/crm/base";
import { analisar } from "@/lib/crm/analise";

export const dynamic = "force-dynamic";

/** Números da base que definem as regras: recompra, RFM, cobertura de telefone, campanhas. */
export async function GET() {
  return NextResponse.json(analisar(await lerBase()));
}
