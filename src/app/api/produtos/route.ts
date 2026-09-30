import { NextRequest, NextResponse } from "next/server";
import { LOJAS, fetchVendasPorProduto } from "@/lib/connectors/totvs";
import { fetchEstoqueCategoria, fetchEstoqueDeProdutos } from "@/lib/connectors/estoque";
import { Agrupamento, categoriaDe, rotulo } from "@/lib/produtos";
import { spMidnight, todaySpKey } from "@/lib/types";

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
  situacao: "ruptura" | "acabando" | "ok" | "parado" | "negativo";
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
  // Sem categoria não há consulta: a tela pede para escolher uma primeiro.
  // TOP20 é o atalho que atravessa todas as categorias.
  const categoria = (sp.get("cat") ?? "").trim().toUpperCase();
  const maisVendidos = categoria === "TOP20";
  // Busca por nome atravessa as categorias; a API do saldo filtra por nome
  const busca = (sp.get("q") ?? "").trim().toUpperCase();
  if (!categoria && !busca) {
    return NextResponse.json({ erro: "Escolha uma categoria", itens: [], transferencias: [] }, { status: 400 });
  }
  const units = (sp.get("units") ?? "").split(",").map((u) => u.trim()).filter(Boolean);
  const lojasSel = units.filter((u) => u !== "Site");
  const filiaisSel = Object.entries(LOJAS)
    .filter(([, nome]) => lojasSel.includes(nome))
    .map(([codigo]) => Number(codigo));

  const vendas = await fetchVendasPorProduto(from, to);

  const combina = (nome: string) =>
    busca ? nome.toUpperCase().includes(busca) : maisVendidos || categoriaDe(nome) === categoria;

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

  // Vendas do período, já agregadas por dia/produto/loja
  for (const v of vendas.itens) {
    if (!combina(v.nome)) continue;
    if (lojasSel.length && !lojasSel.includes(v.loja)) continue;
    const chave = rotulo(v.nome, agrup);
    if (!chave) continue;
    const e = linhas.get(chave) ?? nova(chave);
    e.pecas += v.qtd;
    e.faturamento += v.receita;
    if (v.loja) e.vendasPorLoja[v.loja] = (e.vendasPorLoja[v.loja] ?? 0) + v.qtd;
    linhas.set(chave, e);
  }

  // No atalho dos mais vendidos, só os 20 primeiros seguem adiante
  if (maisVendidos) {
    const top = Array.from(linhas.values())
      .sort((a, b) => b.pecas - a.pecas)
      .slice(0, 20)
      .map((l) => l.produto);
    for (const chave of Array.from(linhas.keys())) {
      if (!top.includes(chave)) linhas.delete(chave);
    }
  }

  /**
   * O saldo vem de TODAS as lojas, mesmo com uma loja filtrada: a pergunta é
   * "Ribeirão vendeu isso, quem tem para mandar?" — restringir o estoque à
   * loja filtrada esconderia justamente a resposta.
   *
   * Nos mais vendidos e na busca, consulta só os produtos da lista; numa
   * categoria inteira, uma consulta só pela categoria sai mais barato.
   */
  const estoque =
    maisVendidos || busca
      ? await fetchEstoqueDeProdutos(Array.from(linhas.values()).map((l) => l.produto))
      : await fetchEstoqueCategoria(categoria);

  /**
   * Casar estoque com venda pelo nome exige tolerância: o nome no cadastro do
   * produto e o nome no item da nota nem sempre são idênticos. Tenta o rótulo
   * exato e, se falhar, a linha cujo nome seja começo do nome do produto.
   */
  const chaves = Array.from(linhas.keys()).sort((a, b) => b.length - a.length);
  const casar = (nomeProduto: string): string | null => {
    const exato = rotulo(nomeProduto, agrup);
    if (linhas.has(exato)) return exato;
    const alvo = nomeProduto.trim().toUpperCase();
    return chaves.find((k) => alvo.startsWith(k.toUpperCase())) ?? null;
  };

  let comSaldoAchado = 0;
  for (const s of estoque.itens) {
    let chave: string | null;
    if (maisVendidos || busca) {
      chave = casar(s.nome);
      if (!chave) continue;
    } else {
      if (!combina(s.nome)) continue;
      chave = rotulo(s.nome, agrup);
      if (!chave) continue;
    }
    const e = linhas.get(chave) ?? nova(chave);
    for (const [loja, qtd] of Object.entries(s.porLoja)) {
      e.estoque += qtd;
      e.porLoja[loja] = (e.porLoja[loja] ?? 0) + qtd;
    }
    comSaldoAchado += 1;
    linhas.set(chave, e);
  }

  const itens = Array.from(linhas.values()).map((l) => {
    const porDia = l.pecas / dias;
    const cobertura = porDia > 0 ? Math.round(l.estoque / porDia) : null;
    let situacao: LinhaProduto["situacao"] = "ok";
    if (l.estoque < 0) situacao = "negativo"; // divergência de inventário
    else if (l.pecas > 0 && l.estoque <= 0) situacao = "ruptura";
    else if (cobertura !== null && cobertura < 15) situacao = "acabando";
    else if (l.pecas === 0 && l.estoque > 0) situacao = "parado";
    return { ...l, cobertura, situacao };
  });

  itens.sort((a, b) =>
    maisVendidos ? b.pecas - a.pecas : b.faturamento - a.faturamento || b.estoque - a.estoque
  );

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
    categoria: busca ? `Busca: ${busca}` : categoria,
    // Diagnóstico do cruzamento: separa "a API não devolveu" de
    // "devolveu mas o nome não bate com o da venda"
    diag: {
      produtosConsultados: linhas.size,
      saldosRecebidos: estoque.itens.length,
      saldosCasados: comSaldoAchado,
      exemploConsultado: Array.from(linhas.keys())[0] ?? "",
      exemploRecebido: estoque.itens[0]?.nome ?? "",
      estoqueErro: estoque.erro ?? "",
    },
    incompleto: vendas.incompleto || Boolean(estoque.incompleto),
    lojasDisponiveis: Object.values(LOJAS),
    erro: estoque.erro ?? vendas.erro,
    itens: itens.slice(0, 400),
    transferencias: transferencias.slice(0, 30),
    totais: {
      produtos: itens.length,
      rupturas: itens.filter((i) => i.situacao === "ruptura").length,
      acabando: itens.filter((i) => i.situacao === "acabando").length,
      parados: itens.filter((i) => i.situacao === "parado").length,
      negativos: itens.filter((i) => i.situacao === "negativo").length,
      pecasEstoque: itens.reduce((s, i) => s + i.estoque, 0),
    },
  });
}
