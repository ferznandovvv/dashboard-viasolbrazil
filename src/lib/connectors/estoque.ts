/**
 * Saldo de estoque das lojas físicas (TOTVS Moda, módulo de produto).
 *
 * O depósito 1 é o FISICO — o que está na loja. O 3 (FIS+INSPECAO) é a soma
 * dele com o 2, então contar os três dobraria o saldo.
 *
 * A API só filtra por nome EXATO de produto (medido: "BOLSA LARI" devolve 0,
 * sem filtro devolve 17.605), então não dá para pedir "os produtos que
 * começam com". A estratégia é baixar o catálogo inteiro de vez em quando,
 * guardar o resultado e filtrar aqui — é o que mantém a tela instantânea.
 */

import { LOJAS, totvsConfigured, totvsFetch } from "./totvs";
import { gravarBlob, lerBlobs } from "../blobCache";
import { rodandoLocal } from "../credenciais";

const BALANCES = "/api/totvsmoda/product/v2/balances/search";
const DEPOSITO_FISICO = 1;
const PAGE = 100;
const PREFIXO = "estoque/";
const CHAVE = "atual";
/** Saldo muda o dia todo, mas de hora em hora basta para decidir reposição. */
const VALIDADE_MS = 60 * 60000;

export interface SaldoProduto {
  /** Nome completo, como vem na nota — é o que permite cruzar com a venda */
  nome: string;
  cor: string;
  tamanho: string;
  /** Saldo por nome de loja */
  porLoja: Record<string, number>;
}

export interface Estoque {
  conectado: boolean;
  itens: SaldoProduto[];
  /** Não deu tempo de varrer tudo nesta requisição */
  incompleto?: boolean;
  /** Quando esta foto do estoque foi tirada */
  em?: string;
  erro?: string;
}

interface Guardado {
  at: number;
  incompleto: boolean;
  /** Página onde parar de varrer, para continuar na próxima chamada */
  proximaPagina?: number;
  itens: SaldoProduto[];
}

interface LinhaSaldo {
  productName?: string;
  colorName?: string;
  sizeName?: string;
  balances?: { branchCode?: number; stockCode?: number; stock?: number }[];
}

let memoria: Guardado | null = null;

/**
 * Foto atual do estoque. Se houver uma recente, devolve na hora; se houver
 * uma velha, devolve a velha mesmo assim (melhor um número de ontem em um
 * segundo do que o de agora em quarenta) e só varre de novo quando não há
 * nada guardado.
 */
export async function fetchEstoque(forcar = false): Promise<Estoque> {
  if (!totvsConfigured()) return { conectado: false, itens: [] };

  if (!forcar && memoria && Date.now() - memoria.at < VALIDADE_MS) return resposta(memoria);

  const guardado = (await lerBlobs<Guardado>(PREFIXO, [CHAVE])).get(CHAVE);
  if (guardado) memoria = guardado;
  if (!forcar && guardado && Date.now() - guardado.at < VALIDADE_MS) return resposta(guardado);

  /**
   * A varredura custa ~180 chamadas de API dentro de uma função de até 60s —
   * foi ela que estourou o limite gratuito da Vercel. Por isso ela só roda
   * quando pedida explicitamente (o cron de madrugada); a tela usa sempre a
   * última foto que existir, mesmo velha ou incompleta, e nunca dispara uma.
   */
  // Na máquina própria não há limite de plano: sem foto, varre na hora
  if (!forcar && rodandoLocal() && (!guardado || guardado.incompleto)) forcar = true;

  if (!forcar) {
    if (guardado) return resposta(guardado);
    return {
      conectado: true,
      itens: [],
      erro: "O estoque ainda não foi carregado. Ele é atualizado todo dia de madrugada.",
    };
  }

  // Pedido explícito: varre, continuando de onde parou se a última ficou pela metade
  const continuar = guardado?.incompleto ? guardado : null;
  const novo = await varrer(continuar?.proximaPagina ?? 1, continuar?.itens ?? []);

  if (novo.itens.length > 0) {
    memoria = {
      at: continuar ? continuar.at : Date.now(),
      incompleto: Boolean(novo.incompleto),
      proximaPagina: novo.proximaPagina,
      itens: novo.itens,
    };
    await gravarBlob(PREFIXO, CHAVE, memoria);
    return resposta(memoria);
  }

  if (guardado) return resposta(guardado);
  return novo;
}

function resposta(g: Guardado): Estoque {
  return {
    conectado: true,
    itens: g.itens,
    incompleto: g.incompleto,
    em: new Date(g.at).toISOString(),
  };
}

/**
 * Varre o catálogo. Como a API só aceita nome exato de produto, não há como
 * pedir menos — então a varredura é retomável: guarda onde parou e a próxima
 * chamada continua dali, até fechar a foto inteira.
 */
async function varrer(
  dePagina: number,
  itensAnteriores: SaldoProduto[]
): Promise<Estoque & { proximaPagina?: number }> {
  const inicio = Date.now();
  const ORCAMENTO = 45000;
  const filiais = Object.keys(LOJAS).map(Number);
  const corpo = (pagina: number) => ({
    filter: { startProductCode: 1, endProductCode: 99999999 },
    option: {
      balances: filiais.map((f) => ({ branchCode: f, stockCodeList: [DEPOSITO_FISICO] })),
    },
    page: pagina,
    pageSize: PAGE,
  });

  const itens: SaldoProduto[] = [...itensAnteriores];
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
    const primeira = await totvsFetch(BALANCES, corpo(dePagina));
    if (primeira.status !== 200) {
      const msg = primeira.json ? JSON.stringify(primeira.json).slice(0, 160) : primeira.text.slice(0, 160);
      return { conectado: true, itens: [], erro: `Estoque: HTTP ${primeira.status} — ${msg}` };
    }
    coletar((primeira.json?.items as LinhaSaldo[] | undefined) ?? []);

    const paginas = Math.min(Math.ceil(Number(primeira.json?.count ?? 0) / PAGE), 300);
    let incompleto = false;
    let pagina = dePagina + 1;
    for (; pagina <= paginas; pagina += 20) {
      if (Date.now() - inicio > ORCAMENTO) {
        incompleto = true;
        break;
      }
      const lote = [];
      for (let p = pagina; p < pagina + 20 && p <= paginas; p++) lote.push(totvsFetch(BALANCES, corpo(p)));
      for (const r of await Promise.all(lote)) {
        if (r.status === 200) coletar((r.json?.items as LinhaSaldo[] | undefined) ?? []);
      }
    }
    return {
      conectado: true,
      itens,
      incompleto,
      proximaPagina: incompleto ? pagina : undefined,
    };
  } catch (e) {
    return { conectado: true, itens, erro: e instanceof Error ? e.message : "Erro desconhecido" };
  }
}
