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
  /** Curva ABC por faturamento acumulado: A até 80%, B até 95%, C o resto */
  abc: "A" | "B" | "C";
  /** Peças vendidas por loja, base das sugestões de transferência */
  vendasPorLoja: Record<string, number>;
}

export interface Transferencia {
  produto: string;
  de: string;
  sobra: number;
  para: string;
  vendeu: number;
  sugestao: number;
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
    abc: "C",
    vendasPorLoja: {},
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
      if (o.store) e.vendasPorLoja[o.store] = (e.vendasPorLoja[o.store] ?? 0) + it.qty;
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

  // Curva ABC: A são os produtos que somam os primeiros 80% do faturamento
  const totalFat = itens.reduce((s, i) => s + i.faturamento, 0);
  let acumulado = 0;
  for (const i of itens) {
    acumulado += i.faturamento;
    const parte = totalFat > 0 ? acumulado / totalFat : 1;
    i.abc = parte <= 0.8 ? "A" : parte <= 0.95 ? "B" : "C";
  }

  // Transferência: uma loja tem saldo parado do que outra vende e não tem.
  // Só sugere quando a origem não vendeu a peça no período — senão seria
  // tirar de quem também está girando.
  const transferencias: Transferencia[] = [];
  for (const l of itens) {
    const faltam = Object.entries(l.vendasPorLoja)
      .filter(([loja, qtd]) => qtd > 0 && (l.porLoja[loja] ?? 0) <= 0)
      .sort((a, b) => b[1] - a[1]);
    if (faltam.length === 0) continue;
    const sobram = Object.entries(l.porLoja)
      .filter(([loja, qtd]) => qtd > 0 && (l.vendasPorLoja[loja] ?? 0) === 0)
      .sort((a, b) => b[1] - a[1]);
    if (sobram.length === 0) continue;
    const [para, vendeu] = faltam[0];
    const [de, sobra] = sobram[0];
    transferencias.push({
      produto: l.produto,
      de,
      sobra,
      para,
      vendeu,
      sugestao: Math.max(1, Math.min(sobra, vendeu)),
    });
  }
  transferencias.sort((a, b) => b.sugestao - a.sugestao);

  return NextResponse.json({
    from,
    to,
    dias,
    agrup,
    lojas: lojasSel,
    estoqueConectado: estoque.conectado,
    erro: estoque.erro ?? vendas.error,
    itens: itens.slice(0, 400),
    transferencias: transferencias.slice(0, 30),
    totais: {
      produtos: itens.length,
      rupturas: itens.filter((i) => i.situacao === "ruptura").length,
      acabando: itens.filter((i) => i.situacao === "acabando").length,
      parados: itens.filter((i) => i.situacao === "parado").length,
      pecasEstoque: itens.reduce((s, i) => s + i.estoque, 0),
    },
  });
}
