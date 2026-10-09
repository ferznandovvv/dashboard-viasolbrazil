import { NextRequest, NextResponse } from "next/server";
import { LOJAS, fetchVendasPorProduto } from "@/lib/connectors/totvs";
import { fetchEstoque } from "@/lib/connectors/estoque";
import { rodandoLocal } from "@/lib/credenciais";
import { todaySpKey } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export interface LinhaProduto {
  /** Nome completo da variação (modelo, cor e tamanho) */
  produto: string;
  /** Peças vendidas nas lojas escolhidas, no período (só nos mais vendidos) */
  vendidas: number;
  /** Peças vendidas por loja, no período */
  vendasPorLoja: Record<string, number>;
  /** Saldo de agora, por loja — sempre de todas as lojas */
  porLoja: Record<string, number>;
}

/** "Boné" acha "BONE" e vice-versa: o cadastro nem sempre tem acento. */
function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

/**
 * Dois jeitos de olhar produto:
 *  - ?modo=busca&q=parte do nome → saldo de agora em todas as lojas
 *  - ?modo=vendidos&from&to&lojas&top → o que mais vendeu nas lojas e no
 *    período escolhidos, com o saldo de agora em todas as lojas ao lado
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const modo = sp.get("modo") === "vendidos" ? "vendidos" : "busca";
  const todasLojas = Object.values(LOJAS);

  // Uma foto só do estoque, filtrada aqui: a API não filtra por parte do nome
  const estoque = await fetchEstoque();
  const base = {
    modo,
    lojas: todasLojas,
    estoqueEm: estoque.em ?? "",
    estoqueIncompleto: Boolean(estoque.incompleto),
    erro: estoque.erro,
  };

  if (modo === "busca") {
    // Cada palavra precisa aparecer, em qualquer ordem: "lari bolsa" acha "BOLSA LARI"
    const palavras = normalizar(sp.get("q") ?? "").split(" ").filter(Boolean);
    if (palavras.length === 0 || palavras.join("").length < 2) {
      return NextResponse.json({ ...base, itens: [], total: 0 });
    }
    const linhas = new Map<string, LinhaProduto>();
    for (const s of estoque.itens) {
      const nome = nomeCompleto(s.nome, s.cor, s.tamanho);
      const alvo = normalizar(nome);
      if (!palavras.every((p) => alvo.includes(p))) continue;
      const e = linhas.get(alvo) ?? { produto: nome, vendidas: 0, vendasPorLoja: {}, porLoja: {} };
      somarSaldo(e, s.porLoja);
      linhas.set(alvo, e);
    }
    const itens = Array.from(linhas.values()).sort((a, b) => a.produto.localeCompare(b.produto, "pt-BR"));
    return NextResponse.json({ ...base, itens: itens.slice(0, 500), total: itens.length });
  }

  // ——— Mais vendidos ———
  const hoje = todaySpKey();
  const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
  let from = sp.get("from") ?? "";
  let to = sp.get("to") ?? "";
  if (!isDate(from) || !isDate(to) || from > to) {
    to = hoje;
    from = `${hoje.slice(0, 7)}-01`;
  }
  if (to > hoje) to = hoje;
  const lojasSel = (sp.get("lojas") ?? "")
    .split(",")
    .map((l) => l.trim())
    .filter((l) => todasLojas.includes(l));
  const top = Math.min(Math.max(Number(sp.get("top")) || 20, 1), 200);

  // Na máquina própria não há limite de tempo: espera o período inteiro
  const vendas = await fetchVendasPorProduto(from, to, rodandoLocal() ? 5 * 60000 : 35000);

  const linhas = new Map<string, LinhaProduto>();
  for (const v of vendas.itens) {
    if (lojasSel.length && !lojasSel.includes(v.loja)) continue;
    const chave = normalizar(v.nome);
    if (!chave) continue;
    const e = linhas.get(chave) ?? { produto: v.nome.trim(), vendidas: 0, vendasPorLoja: {}, porLoja: {} };
    e.vendidas += v.qtd;
    if (v.loja) e.vendasPorLoja[v.loja] = (e.vendasPorLoja[v.loja] ?? 0) + v.qtd;
    linhas.set(chave, e);
  }
  const ranking = Array.from(linhas.entries())
    .filter(([, l]) => l.vendidas > 0)
    .sort((a, b) => b[1].vendidas - a[1].vendidas)
    .slice(0, top);
  const escolhidos = new Map(ranking);

  /**
   * O nome no cadastro do produto e o nome no item da nota nem sempre são
   * idênticos, então o cruzamento aceita o nome exato ou o prefixo.
   */
  const chaves = Array.from(escolhidos.keys()).sort((a, b) => b.length - a.length);
  for (const s of estoque.itens) {
    const alvo = normalizar(nomeCompleto(s.nome, s.cor, s.tamanho));
    const curto = normalizar(s.nome);
    const chave = escolhidos.has(alvo)
      ? alvo
      : escolhidos.has(curto)
        ? curto
        : chaves.find((k) => alvo.startsWith(k) || k.startsWith(alvo));
    if (chave) somarSaldo(escolhidos.get(chave)!, s.porLoja);
  }

  return NextResponse.json({
    ...base,
    from,
    to,
    lojasSel,
    top,
    vendasIncompletas: vendas.incompleto,
    erro: vendas.erro ?? estoque.erro,
    itens: ranking.map(([, l]) => l),
    total: ranking.length,
  });
}

/** Nome da nota já traz cor e tamanho; o do saldo às vezes vem separado. */
function nomeCompleto(nome: string, cor: string, tamanho: string): string {
  const base = nome.trim();
  const tem = normalizar(base);
  const extra = [cor, tamanho].filter((x) => x && !` ${tem} `.includes(` ${normalizar(x)} `));
  return [base, ...extra].join(" ");
}

function somarSaldo(l: LinhaProduto, porLoja: Record<string, number>) {
  for (const [loja, qtd] of Object.entries(porLoja)) l.porLoja[loja] = (l.porLoja[loja] ?? 0) + qtd;
}
