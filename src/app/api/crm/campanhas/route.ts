import { NextRequest, NextResponse } from "next/server";
import { alterarBase, lerBase } from "@/lib/crm/base";
import { type PedidoCampanha, cancelarCampanha, criarCampanha, listarCampanhas, previa } from "@/lib/crm/campanhas";
import type { FiltroCampanha } from "@/lib/crm/tipos";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Campanhas manuais (com o que renderam) e o resultado das automáticas nos últimos 30 dias. */
export async function GET() {
  return NextResponse.json(listarCampanhas(await lerBase()));
}

type Pedido =
  | { acao: "previa"; filtro: FiltroCampanha; variacoes?: string[]; oferta?: string }
  | ({ acao: "criar" } & PedidoCampanha)
  | { acao: "cancelar"; id: string };

const filtroLimpo = (f: Partial<FiltroCampanha> | undefined): FiltroCampanha => {
  const num = (v: unknown) => (Number(v) > 0 ? Number(v) : undefined);
  return {
    lojas: Array.isArray(f?.lojas) ? f.lojas.map(String) : [],
    faixas: Array.isArray(f?.faixas) ? (f.faixas as FiltroCampanha["faixas"]) : [],
    semComprarDias: num(f?.semComprarDias),
    compraramDias: num(f?.compraramDias),
    gastoMinimo: num(f?.gastoMinimo),
    comSaldo: Boolean(f?.comSaldo) || undefined,
    aniversariantes: Boolean(f?.aniversariantes) || undefined,
    limite: num(f?.limite),
  };
};

export async function POST(req: NextRequest) {
  const p = (await req.json().catch(() => ({}))) as Pedido;
  try {
    if (p.acao === "previa") return NextResponse.json(previa(await lerBase(), filtroLimpo(p.filtro), p.variacoes ?? [], p.oferta?.trim() || undefined));
    if (p.acao === "criar") {
      const c = await alterarBase((b) => criarCampanha(b, { ...p, filtro: filtroLimpo(p.filtro), variacoes: Array.isArray(p.variacoes) ? p.variacoes.map(String) : [] }));
      return NextResponse.json(c);
    }
    if (p.acao === "cancelar") return NextResponse.json({ canceladas: await alterarBase((b) => cancelarCampanha(b, p.id)) });
    return NextResponse.json({ erro: "Ação desconhecida." }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ erro: e instanceof Error ? e.message : "Erro" }, { status: 400 });
  }
}
