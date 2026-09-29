/**
 * Saldo de estoque das lojas físicas (TOTVS Moda, módulo de produto).
 *
 * O depósito 1 é o FISICO — o que está na loja. O 3 (FIS+INSPECAO) é a soma
 * dele com o 2, então contar os três dobraria o saldo.
 */

import { LOJAS, totvsConfigured, totvsFetch } from "./totvs";
import { comCache } from "../cache";

const BALANCES = "/api/totvsmoda/product/v2/balances/search";
const DEPOSITO_FISICO = 1;
const PAGE = 100;

export interface SaldoProduto {
  /** Nome completo, como vem na nota — é o que permite cruzar com a venda */
  nome: string;
  cor: string;
  tamanho: string;
  /** Saldo por nome de loja */
  porLoja: Record<string, number>;
}

interface LinhaSaldo {
  productName?: string;
  colorName?: string;
  sizeName?: string;
  balances?: { branchCode?: number; stockCode?: number; stock?: number }[];
}

export interface Estoque {
  conectado: boolean;
  itens: SaldoProduto[];
  /** Não deu tempo de varrer tudo nesta requisição */
  incompleto?: boolean;
  erro?: string;
}

export async function fetchEstoque(): Promise<Estoque> {
  if (!totvsConfigured()) return { conectado: false, itens: [] };
  // Saldo muda o dia todo, mas de hora em hora é resolução de sobra para
  // decidir reposição — e a consulta inteira custa quase 200 páginas
  return comCache("estoque|fisico", buscarEstoque, 60 * 60000);
}

async function buscarEstoque(): Promise<Estoque> {
  const inicio = Date.now();
  const ORCAMENTO = 30000; // além disso a rota estoura o tempo da Vercel
  const filiais = Object.keys(LOJAS).map(Number);
  const corpo = (pagina: number) => ({
    filter: { startProductCode: 1, endProductCode: 99999999 },
    option: {
      balances: filiais.map((f) => ({ branchCode: f, stockCodeList: [DEPOSITO_FISICO] })),
    },
    page: pagina,
    pageSize: PAGE,
  });

  const itens: SaldoProduto[] = [];
  const coletar = (linhas: LinhaSaldo[]) => {
    for (const l of linhas) {
      const nome = (l.productName ?? "").trim();
      if (!nome) continue;
      const porLoja: Record<string, number> = {};
      for (const b of l.balances ?? []) {
        if (b.stockCode !== DEPOSITO_FISICO) continue;
        const loja = LOJAS[b.branchCode ?? 0];
        const qtd = Number(b.stock ?? 0);
        if (!loja || qtd === 0) continue;
        porLoja[loja] = (porLoja[loja] ?? 0) + qtd;
      }
      // Produto zerado em todas as lojas só ocuparia espaço
      if (Object.keys(porLoja).length === 0) continue;
      itens.push({ nome, cor: l.colorName ?? "", tamanho: l.sizeName ?? "", porLoja });
    }
  };

  try {
    const primeira = await totvsFetch(BALANCES, corpo(1));
    if (primeira.status !== 200) {
      const msg = primeira.json ? JSON.stringify(primeira.json).slice(0, 160) : primeira.text.slice(0, 160);
      return { conectado: true, itens: [], erro: `Estoque: HTTP ${primeira.status} — ${msg}` };
    }
    coletar((primeira.json?.items as LinhaSaldo[] | undefined) ?? []);

    const paginas = Math.min(Math.ceil(Number(primeira.json?.count ?? 0) / PAGE), 250);
    let incompleto = false;
    for (let pagina = 2; pagina <= paginas; pagina += 15) {
      if (Date.now() - inicio > ORCAMENTO) {
        incompleto = true;
        break;
      }
      const lote = [];
      for (let p = pagina; p < pagina + 15 && p <= paginas; p++) lote.push(totvsFetch(BALANCES, corpo(p)));
      for (const r of await Promise.all(lote)) {
        if (r.status === 200) coletar((r.json?.items as LinhaSaldo[] | undefined) ?? []);
      }
    }
    return { conectado: true, itens, incompleto };
  } catch (e) {
    return { conectado: true, itens, erro: e instanceof Error ? e.message : "Erro desconhecido" };
  }
}
