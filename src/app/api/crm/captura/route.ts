import { NextRequest, NextResponse } from "next/server";
import { LOJAS } from "@/lib/connectors/totvs";
import { lerBase } from "@/lib/crm/base";
import { capturaCelular } from "@/lib/crm/captura";
import { aprenderVendedoras } from "@/lib/crm/vendasLoja";

export const dynamic = "force-dynamic";

/** Celular no caixa por loja (?dias=7|30) e, com ?loja=, por vendedora e as vendas sem celular. */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const dias = [7, 14, 30, 60].includes(Number(q.get("dias"))) ? Number(q.get("dias")) : 30;
  const loja = q.get("loja") ?? undefined;
  if (loja && !Object.values(LOJAS).includes(loja)) return NextResponse.json({ erro: "Loja não encontrada" }, { status: 400 });
  const base = await lerBase();
  if (loja) await aprenderVendedoras(base).catch(() => {});
  return NextResponse.json(capturaCelular(base, dias, loja));
}
