import { NextRequest, NextResponse } from "next/server";
import { LOJAS, fetchVendasPorProduto } from "@/lib/connectors/totvs";
import { fetchEstoque } from "@/lib/connectors/estoque";
import { fetchPrecos, tabelasVisiveis } from "@/lib/connectors/precos";
import { rodandoLocal } from "@/lib/credenciais";
import { lojasDoEstoque } from "@/lib/acesso/lojas";
import { tabelasDasLojas } from "@/lib/tabelasDePreco";
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
  /** Saldo de agora, por loja — de todas as lojas que o usuário vê */
  porLoja: Record<string, number>;
  /** Preço de venda por tabela (Site, Franca, RP) */
  precos: Record<string, number>;
}

/**
 * Itens que saem na nota mas não são produto (frete de motoboy): ficam fora
 * das listas por enquanto, e a tela avisa que estão sendo ignorados.
 */
const IGNORAR = [/^FRETE\b/];
const ignorado = (nomeNormalizado: string) => IGNORAR.some((r) => r.test(nomeNormalizado));

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
 *
 * O usuário de loja só recebe o saldo e o preço das lojas dele: o resto nem
 * sai daqui.
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const modo = sp.get("modo") === "vendidos" ? "vendidos" : "busca";
  const lojasVistas = await lojasDoEstoque(req);
  const restrito = lojasVistas.length < Object.keys(LOJAS).length;

  // Uma foto só do estoque, filtrada aqui: a API não filtra por parte do nome
  const [estoque, precos] = await Promise.all([fetchEstoque(), fetchPrecos()]);
  const deLoja = tabelasDasLojas(lojasVistas);
  const tabelas = tabelasVisiveis(precos).filter((t) => !restrito || deLoja.includes(t.rotulo));
  /** Preço do produto em cada tabela, pelo código da TOTVS */
  const anexarPreco = (l: LinhaProduto, codigo?: number) => {
    const p = codigo !== undefined ? precos?.porProduto[String(codigo)] : undefined;
    if (!p) return;
    for (const t of tabelas) if (p[t.codigo] && !l.precos[t.rotulo]) l.precos[t.rotulo] = p[t.codigo];
  };
  const base = {
    modo,
    lojas: lojasVistas,
    tabelas: tabelas.map((t) => t.rotulo),
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
      if (!palavras.every((p) => alvo.includes(p)) || ignorado(alvo)) continue;
      const e = linhas.get(alvo) ?? { produto: nome, vendidas: 0, vendasPorLoja: {}, porLoja: {}, precos: {} };
      somarSaldo(e, s.porLoja, lojasVistas);
      anexarPreco(e, s.codigo);
      linhas.set(alvo, e);
    }

    // ?vendas=1: junta as peças vendidas no período, por loja. É a segunda
    // busca da tela — o estoque aparece antes e as vendas completam depois
    let vendasInfo = {};
    if (sp.get("vendas") === "1") {
      const { from, to } = periodoDe(sp);
      const inicio = Date.now();
      const vendas = await fetchVendasPorProduto(from, to, rodandoLocal() ? 5 * 60000 : 35000);
      const chaves = Array.from(linhas.keys()).sort((a, b) => b.length - a.length);
      for (const v of vendas.itens) {
        if (!lojasVistas.includes(v.loja)) continue;
        const chave = normalizar(v.nome);
        if (!chave || !palavras.every((p) => chave.includes(p)) || ignorado(chave)) continue;
        // Nome da nota igual ao do estoque ou começando igual (mesmo cruzamento dos mais vendidos)
        const k = linhas.has(chave) ? chave : chaves.find((x) => chave.startsWith(x) || x.startsWith(chave));
        let e = k ? linhas.get(k) : undefined;
        if (!e) {
          // Vendeu e não tem saldo em loja nenhuma: aparece assim mesmo
          e = { produto: v.nome.trim(), vendidas: 0, vendasPorLoja: {}, porLoja: {}, precos: {} };
          linhas.set(chave, e);
        }
        e.vendidas += v.qtd;
        if (v.loja) e.vendasPorLoja[v.loja] = (e.vendasPorLoja[v.loja] ?? 0) + v.qtd;
      }
      vendasInfo = { from, to, vendasMs: Date.now() - inicio, vendasIncompletas: vendas.incompleto, erro: vendas.erro ?? estoque.erro };
    }

    // Para a loja, só o que tem saldo (ou divergência) nas lojas dela
    const itens = Array.from(linhas.values())
      .filter((l) => !restrito || Object.values(l.porLoja).some((q) => q !== 0))
      .sort((a, b) => a.produto.localeCompare(b.produto, "pt-BR"));
    return NextResponse.json({ ...base, ...vendasInfo, itens: itens.slice(0, 500), total: itens.length });
  }

  // ——— Mais vendidos ———
  const { from, to } = periodoDe(sp);
  const lojasSel = (sp.get("lojas") ?? "")
    .split(",")
    .map((l) => l.trim())
    .filter((l) => lojasVistas.includes(l));
  const top = Math.min(Math.max(Number(sp.get("top")) || 20, 1), 200);

  // Na máquina própria não há limite de tempo: espera o período inteiro
  const vendas = await fetchVendasPorProduto(from, to, rodandoLocal() ? 5 * 60000 : 35000);

  const linhas = new Map<string, LinhaProduto>();
  const ignorados = new Map<string, number>();
  for (const v of vendas.itens) {
    if (lojasSel.length ? !lojasSel.includes(v.loja) : restrito && !lojasVistas.includes(v.loja)) continue;
    const chave = normalizar(v.nome);
    if (!chave) continue;
    if (ignorado(chave)) {
      ignorados.set(v.nome.trim(), (ignorados.get(v.nome.trim()) ?? 0) + v.qtd);
      continue;
    }
    const e = linhas.get(chave) ?? { produto: v.nome.trim(), vendidas: 0, vendasPorLoja: {}, porLoja: {}, precos: {} };
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
    if (chave) {
      somarSaldo(escolhidos.get(chave)!, s.porLoja, lojasVistas);
      anexarPreco(escolhidos.get(chave)!, s.codigo);
    }
  }

  return NextResponse.json({
    ...base,
    from,
    to,
    lojasSel,
    top,
    vendasIncompletas: vendas.incompleto,
    ignorados: Array.from(ignorados, ([produto, vendidas]) => ({ produto, vendidas })),
    erro: vendas.erro ?? estoque.erro,
    itens: ranking.map(([, l]) => l),
    total: ranking.length,
  });
}

/** Período pedido (?from&to); sem um válido, o mês atual. Nunca passa de hoje. */
function periodoDe(sp: URLSearchParams): { from: string; to: string } {
  const hoje = todaySpKey();
  const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
  const from = sp.get("from") ?? "";
  const to = sp.get("to") ?? "";
  if (!isDate(from) || !isDate(to) || from > to) return { from: `${hoje.slice(0, 7)}-01`, to: hoje };
  return { from, to: to > hoje ? hoje : to };
}

/** Nome da nota já traz cor e tamanho; o do saldo às vezes vem separado. */
function nomeCompleto(nome: string, cor: string, tamanho: string): string {
  const base = nome.trim();
  const tem = normalizar(base);
  const extra = [cor, tamanho].filter((x) => x && !` ${tem} `.includes(` ${normalizar(x)} `));
  return [base, ...extra].join(" ");
}

function somarSaldo(l: LinhaProduto, porLoja: Record<string, number>, lojas: string[]) {
  for (const [loja, qtd] of Object.entries(porLoja))
    if (lojas.includes(loja)) l.porLoja[loja] = (l.porLoja[loja] ?? 0) + qtd;
}
