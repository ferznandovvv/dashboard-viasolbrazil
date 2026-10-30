import { NextRequest, NextResponse } from "next/server";
import { alterarBase, lerBase } from "@/lib/crm/base";
import { type PedidoCampanha, cancelarCampanha, criarCampanha, listarCampanhas, previa } from "@/lib/crm/campanhas";
import type { FiltroCampanha } from "@/lib/crm/tipos";
import { fazerRepescagem, previaRepescagem } from "@/lib/crm/repescagem";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Campanhas manuais (com o que renderam) e o resultado das automáticas nos últimos 30 dias. */
export async function GET() {
  return NextResponse.json(listarCampanhas(await lerBase()));
}

type Pedido =
  | { acao: "previa"; filtro: FiltroCampanha; variacoes?: string[]; oferta?: string }
  | ({ acao: "criar" } & PedidoCampanha)
  | { acao: "cancelar"; id: string }
  | { acao: "repescagem-previa"; dias?: number; minimo?: number }
  | { acao: "repescagem"; dias?: number; minimo?: number };

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
    if (p.acao === "repescagem-previa" || p.acao === "repescagem") {
      const dias = Math.min(120, Math.max(7, Number(p.dias) || 60));
      const minimo = Math.max(0, Number(p.minimo) || 10);
      if (p.acao === "repescagem-previa") return NextResponse.json(previaRepescagem(await lerBase(), dias, minimo));
      const r = await alterarBase((b) => fazerRepescagem(b, dias, minimo));
      const fora = Object.entries(r.naoEntraram).map(([m, n]) => `${n} ${m}`).join(", ");
      return NextResponse.json({
        ok: true,
        ...r,
        detalhe: r.clientes
          ? `Pronto: ${r.clientes} ${r.clientes === 1 ? "cliente teve" : "clientes tiveram"} o cashback reativado (${r.valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}) e os avisos entraram na fila.${fora ? ` Ficaram de fora: ${fora}.` : ""}`
          : `Ninguém pra reativar agora.${fora ? ` Ficaram de fora: ${fora}.` : ""}`,
      });
    }
    if (p.acao === "cancelar") return NextResponse.json({ canceladas: await alterarBase((b) => cancelarCampanha(b, p.id)) });
    return NextResponse.json({ erro: "Ação desconhecida." }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ erro: e instanceof Error ? e.message : "Erro" }, { status: 400 });
  }
}
