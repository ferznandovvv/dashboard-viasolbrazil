import { NextResponse } from "next/server";
import { lerBase } from "@/lib/crm/base";
import { analisar } from "@/lib/crm/analise";
import { aprenderVendedoras } from "@/lib/crm/vendasLoja";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Números da base que definem as regras: recompra, RFM, cobertura de telefone, campanhas. */
export async function GET() {
  const base = await lerBase();
  await aprenderVendedoras(base).catch(() => {});
  return NextResponse.json(analisar(base));
}
