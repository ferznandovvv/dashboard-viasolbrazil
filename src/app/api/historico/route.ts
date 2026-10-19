import { NextResponse } from "next/server";
import { historicoMensal } from "@/lib/historico";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Vendas mês a mês desde 2023, por loja e do site (planilha antiga + TOTVS + Shopify). */
export async function GET() {
  return NextResponse.json(await historicoMensal());
}
