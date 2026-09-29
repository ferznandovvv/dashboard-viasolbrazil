import { NextRequest, NextResponse } from "next/server";
import { LOJAS, fetchTotvsSales } from "@/lib/connectors/totvs";
import { fetchEstoque } from "@/lib/connectors/estoque";
import { Agrupamento, rotulo } from "@/lib/produtos";
import { spDateKey, spMidnight, todaySpKey } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export interface LinhaProduto {
  produto: string;
  pecas: number;
  faturamento: number;
  estoque: number;
  /** Saldo por loja, para decidir transferência */
  porLoja: Record<string, number>;
  /** Dias que o estoque dura no ritmo do período; null quando não vende */
  cobertura: number | null;
  situacao: "ruptura" | "acabando" | "ok" | "parado";
}

/**
 * Relação venda × estoque por produto. Venda vem das notas do período,
 * estoque é o saldo de agora — por isso a cobertura é uma projeção, não um
 * número histórico.
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const hoje = todaySpKey();
  const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
  let from = sp.get("from") ?? "";
  let to = sp.get("to") ?? "";
  if (!isDate(from) || !isDate(to) || from > to) {
    to = hoje;
    from = `${hoje.slice(0, 7)}-01`;
  }
  if (to > hoje) to = hoje;
  const dias = Math.max(
    1,
    Math.round((spMidnight(to).getTime() - spMidnight(from).getTime()) / 86400000) + 1
  );

  const agrup = (sp.get("agrup") ?? "modelo") as Agrupamento;
  const units = (sp.get("units") ?? "").split(",").map((u) => u.trim()).filter(Boolean);
  const lojasSel = units.filter((u) => u !== "Site");
  const filiaisSel = Object.entries(LOJAS)
    .filter(([, nome]) => lojasSel.includes(nome))
    .map(([codigo]) => Number(codigo));

  const [vendas, estoque] = await Promise.all([
    fetchTotvsSales(from, to, { itens: true, ...(filiaisSel.length ? { filiais: filiaisSel } : {}) }),
    fetchEstoque(),
  ]);

  const linhas = new Map<string, LinhaProduto>();
  const nova = (produto: string): LinhaProduto => ({
    produto,
    pecas: 0,
    faturamento: 0,
    estoque: 0,
    porLoja: {},
    cobertura: null,
    situacao: "ok",
  });

  // Vendas do período
  for (const o of vendas.orders) {
    if (lojasSel.length && !lojasSel.includes(o.store ?? "")) continue;
    const dia = spDateKey(o.createdAt);
    if (dia < from || dia > to) continue;
    for (const it of o.items ?? []) {
      const chave = rotulo(it.title, agrup);
      if (!chave) continue;
      const e = linhas.get(chave) ?? nova(chave);
      e.pecas += it.qty;
      e.faturamento += it.revenue;
      linhas.set(chave, e);
    }
  }

  // Saldo atual, restrito às lojas filtradas
  for (const s of estoque.itens) {
    const chave = rotulo(s.nome, agrup);
    if (!chave) continue;
    const e = linhas.get(chave) ?? nova(chave);
    for (const [loja, qtd] of Object.entries(s.porLoja)) {
      if (lojasSel.length && !lojasSel.includes(loja)) continue;
      e.estoque += qtd;
      e.porLoja[loja] = (e.porLoja[loja] ?? 0) + qtd;
    }
    linhas.set(chave, e);
  }

  const itens = Array.from(linhas.values()).map((l) => {
    const porDia = l.pecas / dias;
    const cobertura = porDia > 0 ? Math.round(l.estoque / porDia) : null;
    let situacao: LinhaProduto["situacao"] = "ok";
    if (l.pecas > 0 && l.estoque <= 0) situacao = "ruptura";
    else if (cobertura !== null && cobertura < 15) situacao = "acabando";
    else if (l.pecas === 0 && l.estoque > 0) situacao = "parado";
    return { ...l, cobertura, situacao };
  });

  itens.sort((a, b) => b.faturamento - a.faturamento || b.estoque - a.estoque);

  return NextResponse.json({
    from,
    to,
    dias,
    agrup,
    lojas: lojasSel,
    estoqueConectado: estoque.conectado,
    erro: estoque.erro ?? vendas.error,
    itens: itens.slice(0, 400),
    totais: {
      produtos: itens.length,
      rupturas: itens.filter((i) => i.situacao === "ruptura").length,
      acabando: itens.filter((i) => i.situacao === "acabando").length,
      parados: itens.filter((i) => i.situacao === "parado").length,
      pecasEstoque: itens.reduce((s, i) => s + i.estoque, 0),
    },
  });
}
