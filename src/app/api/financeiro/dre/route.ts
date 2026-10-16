import { NextRequest, NextResponse } from "next/server";
import { exigir } from "@/lib/financeiro/auth";
import { receitaDoAno } from "@/lib/financeiro/receita";
import { pedacos } from "@/lib/financeiro/rateio";
import { GRUPOS, type Conta, type GrupoDre, type LinhaDre } from "@/lib/financeiro/tipos";
import { todaySpKey } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * DRE do ano, mês a mês. ?ano=2026 &empresa=id|"" (todas) &regime=competencia|caixa.
 * Competência: despesa no mês a que se refere (aberta ou paga). Caixa: só o
 * que foi pago, no mês do pagamento. A receita é a venda do mês nos dois.
 */
export async function GET(req: NextRequest) {
  const atual = await exigir(req, { dre: true });
  if (atual instanceof NextResponse) return atual;
  const { base } = atual;
  const sp = req.nextUrl.searchParams;
  const hoje = todaySpKey();
  const ano = Number(sp.get("ano")) || Number(hoje.slice(0, 4));
  const empresaId = sp.get("empresa") ?? "";
  const regime = sp.get("regime") === "caixa" ? "caixa" : "competencia";
  /** DRE de uma loja só: a venda dela e a parte dela nas contas rateadas */
  const unidade = sp.get("unidade") ?? "";

  // Ano corrente vai até o mês de hoje; anos passados, os 12 meses
  const ultimoMes = ano === Number(hoje.slice(0, 4)) ? Number(hoje.slice(5, 7)) : 12;
  const meses = Array.from({ length: ultimoMes }, (_, i) => `${ano}-${String(i + 1).padStart(2, "0")}`);
  const idx = new Map(meses.map((m, i) => [m, i]));
  const zeros = () => meses.map(() => 0);

  const empresas = base.empresas.filter((e) => !empresaId || e.id === empresaId);
  const unidades = unidade ? new Set([unidade]) : new Set(empresas.flatMap((e) => e.unidades));

  // Receita: venda das unidades da(s) empresa(s)
  const receitaAno = await receitaDoAno(ano);
  const receita = zeros();
  for (const [mes, porUnidade] of Object.entries(receitaAno.porMes)) {
    const i = idx.get(mes);
    if (i === undefined) continue;
    for (const [u, v] of Object.entries(porUnidade)) if (unidades.has(u)) receita[i] += v;
  }

  // Despesas por categoria, no mês do regime escolhido. Conta rateada entra
  // em cada empresa/loja só com a parte que é dela
  const ids = new Set(empresas.map((e) => e.id));
  const porCategoria = new Map<string, number[]>();
  let semLoja = 0;
  const mesDe = (c: Conta) => (regime === "caixa" ? (c.status === "paga" ? c.pagoEm?.slice(0, 7) : undefined) : c.competencia);
  for (const c of base.contas) {
    const i = idx.get(mesDe(c) ?? "");
    if (i === undefined) continue;
    const v = c.status === "paga" ? c.valorPago ?? c.valor : c.valor;
    for (const p of pedacos(c, base)) {
      if (unidade ? p.unidade !== unidade : !ids.has(p.empresaId)) {
        if (unidade && !p.unidade && ids.has(p.empresaId)) semLoja += v * p.fracao;
        continue;
      }
      const linha = porCategoria.get(c.categoriaId) ?? zeros();
      linha[i] += v * p.fracao;
      porCategoria.set(c.categoriaId, linha);
    }
  }

  const somaVet = (...vs: number[][]) => meses.map((_, i) => vs.reduce((s, v) => s + v[i], 0));
  const menos = (a: number[], b: number[]) => meses.map((_, i) => a[i] - b[i]);
  const total = (v: number[]) => v.reduce((s, x) => s + x, 0);
  const linhas: LinhaDre[] = [];
  const push = (l: Omit<LinhaDre, "total">) => linhas.push({ ...l, total: total(l.valores) });
  const margem = (chave: string, rotulo: string, v: number[]) =>
    linhas.push({
      chave,
      rotulo,
      tipo: "margem",
      valores: meses.map((_, i) => (receita[i] > 0 ? (v[i] / receita[i]) * 100 : 0)),
      total: total(receita) > 0 ? (total(v) / total(receita)) * 100 : 0,
    });

  const grupo = (g: GrupoDre): number[] => {
    const info = GRUPOS.find((x) => x.id === g)!;
    const cats = base.categorias.filter((c) => c.grupo === g && porCategoria.has(c.id));
    const soma = cats.length ? somaVet(...cats.map((c) => porCategoria.get(c.id)!)) : zeros();
    push({ chave: g, rotulo: info.nome, tipo: "grupo", grupo: g, valores: soma });
    for (const c of cats.sort((a, b) => total(porCategoria.get(b.id)!) - total(porCategoria.get(a.id)!)))
      push({ chave: `cat:${c.id}`, rotulo: c.nome, tipo: "categoria", grupo: g, valores: porCategoria.get(c.id)! });
    return soma;
  };

  push({ chave: "receita", rotulo: "Receita bruta (vendas)", tipo: "receita", valores: receita });
  const deducoes = grupo("deducoes");
  const liquida = menos(receita, deducoes);
  push({ chave: "liquida", rotulo: "Receita líquida", tipo: "subtotal", valores: liquida });
  const cmv = grupo("cmv");
  const bruto = menos(liquida, cmv);
  push({ chave: "bruto", rotulo: "Lucro bruto", tipo: "subtotal", valores: bruto });
  margem("m-bruto", "margem bruta", bruto);
  const operacionais = somaVet(grupo("pessoal"), grupo("ocupacao"), grupo("marketing"), grupo("administrativas"));
  const operacional = menos(bruto, operacionais);
  push({ chave: "operacional", rotulo: "Resultado operacional", tipo: "subtotal", valores: operacional });
  const financeiras = grupo("financeiras");
  const liquido = menos(operacional, financeiras);
  push({ chave: "liquido", rotulo: "Resultado líquido", tipo: "subtotal", valores: liquido });
  margem("m-liquido", "margem líquida", liquido);
  const fora = somaVet(grupo("investimentos"), grupo("retiradas"));
  push({ chave: "saldo", rotulo: "Sobra depois de investimentos e retiradas", tipo: "subtotal", valores: menos(liquido, fora) });

  return NextResponse.json({
    ano,
    regime,
    meses,
    linhas,
    avisos: receitaAno.avisos,
    /** No DRE por loja: despesas da empresa lançadas sem loja, que ficaram de fora */
    semLoja,
    unidades: Array.from(unidades),
  });
}
