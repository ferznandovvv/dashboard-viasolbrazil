/**
 * Preço de venda por tabela (TOTVS Moda, módulo de produto).
 *
 * Cada código de preço é uma tabela (Site, Franca, Ribeirão…). Como o saldo,
 * a API não filtra por parte do nome, então a estratégia é a mesma: baixar o
 * catálogo inteiro em segundo plano, guardar e cruzar aqui pelo código do
 * produto.
 */

import { totvsConfigured, totvsFetch } from "./totvs";
import { gravarBlob, lerBlobs } from "../blobCache";
import { rodandoLocal } from "../credenciais";

const PRECOS = "/api/totvsmoda/product/v2/prices/search";
const PREFIXO = "precos/";
const CHAVE = "atual";
const PAGE = 100;
/** Preço muda pouco: refaz a foto a cada 12 horas */
const VALIDADE_MS = 12 * 60 * 60000;
/** Filial usada na consulta (a API exige uma); o preço da tabela é o mesmo */
const FILIAL = 1;

export interface Tabela {
  codigo: number;
  /** Nome curto para a coluna: Site, Franca, RP */
  rotulo: string;
  nome: string;
}

export interface Precos {
  at: number;
  tabelas: Tabela[];
  /** código do produto → código da tabela → preço */
  porProduto: Record<string, Record<string, number>>;
}

// Compartilhado pelo processo: cada rota do Next tem suas próprias variáveis de módulo
const global = globalThis as unknown as {
  __varreduraPrecos?: Promise<void> | null;
  __situacaoPrecos?: string;
};
let memoria: Precos | null = null;

/** Estado da foto de preços, para diagnóstico. */
export async function situacaoPrecos(): Promise<string> {
  const p = await fetchPrecos();
  const foto = p
    ? `foto de ${new Date(p.at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}: ${
        Object.keys(p.porProduto).length
      } produtos, tabelas ${p.tabelas.map((t) => `${t.codigo}→${t.rotulo}`).join(", ") || "nenhuma"}`
    : "nenhuma foto de preços guardada";
  return `${foto}\nvarredura: ${global.__varreduraPrecos ? "rodando agora" : (global.__situacaoPrecos ?? "ainda não varreu nesta execução")}`;
}

/** Site, Franca, RP — na ordem em que aparecem na tela. */
function rotular(nome: string, codigo: number): string {
  const n = nome.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
  if (n.includes("SITE") || n.includes("ECOMM") || n.includes("ONLINE")) return "Site";
  if (n.includes("FRANCA")) return "Franca";
  if (n.includes("RIBEIRAO") || /\bRP\b/.test(n)) return "RP";
  return nome.trim() || `Tabela ${codigo}`;
}
const ORDEM = ["Site", "Franca", "RP"];
const ordenar = (t: Tabela[]) =>
  [...t].sort(
    (a, b) =>
      (ORDEM.indexOf(a.rotulo) + 1 || 99) - (ORDEM.indexOf(b.rotulo) + 1 || 99) || a.codigo - b.codigo
  );

/**
 * Foto atual dos preços. Nunca faz a tela esperar: devolve a que houver e,
 * na máquina própria, refaz em segundo plano quando está velha.
 */
export async function fetchPrecos(forcar = false): Promise<Precos | null> {
  if (!totvsConfigured()) return null;
  if (!forcar && memoria && Date.now() - memoria.at < VALIDADE_MS) return memoria;

  const guardado = (await lerBlobs<Precos>(PREFIXO, [CHAVE])).get(CHAVE);
  if (guardado && (!memoria || guardado.at >= memoria.at)) memoria = guardado;

  const velho = !memoria || Date.now() - memoria.at > VALIDADE_MS;
  if ((forcar || velho) && (rodandoLocal() || forcar)) {
    const v = varrer();
    if (forcar) await v;
  }
  return memoria;
}

function varrer(): Promise<void> {
  if (global.__varreduraPrecos) return global.__varreduraPrecos;
  const tarefa = (async () => {
    // Descobre quais códigos de preço existem: a API recusa a consulta
    // inteira dizendo "Price N not found" para cada um que não existe
    let codigos = Array.from({ length: 20 }, (_, i) => i + 1);
    const corpo = (pagina: number) => ({
      filter: { startProductCode: 1, endProductCode: 99999999 },
      option: { prices: [{ branchCode: FILIAL, priceCodeList: codigos }] },
      page: pagina,
      pageSize: PAGE,
    });
    let primeira = await totvsFetch(PRECOS, corpo(1));
    if (primeira.status === 400) {
      const faltam = new Set(
        Array.from(primeira.text.matchAll(/Price (\d+) not found/g), (m) => Number(m[1]))
      );
      codigos = codigos.filter((c) => !faltam.has(c));
      if (codigos.length === 0) {
        global.__situacaoPrecos = "nenhum código de preço de 1 a 20 existe";
        return;
      }
      primeira = await totvsFetch(PRECOS, corpo(1));
    }
    if (primeira.status !== 200) {
      global.__situacaoPrecos = `erro HTTP ${primeira.status}: ${primeira.text.slice(0, 300)}`;
      console.error("[precos]", global.__situacaoPrecos);
      return;
    }

    const porProduto: Precos["porProduto"] = {};
    const nomes = new Map<number, string>();
    const coletar = (json: Record<string, unknown> | null) => {
      for (const it of (json?.items as Record<string, unknown>[] | undefined) ?? []) {
        const codigo = String(it.productCode ?? "");
        if (!codigo) continue;
        for (const p of (it.prices as Record<string, unknown>[] | undefined) ?? []) {
          const tabela = Number(p.priceCode);
          const valor = Number(p.price ?? 0);
          if (!tabela || !(valor > 0)) continue;
          if (p.priceName) nomes.set(tabela, String(p.priceName));
          (porProduto[codigo] ??= {})[String(tabela)] = valor;
        }
      }
    };
    coletar(primeira.json);

    const j = primeira.json ?? {};
    const paginas = Math.min(
      Number(j.totalPages) || Math.ceil(Number(j.totalItems ?? j.count ?? 0) / PAGE) || 1,
      600
    );
    for (let pagina = 2; pagina <= paginas; pagina += 10) {
      const lote = [];
      for (let p = pagina; p < pagina + 10 && p <= paginas; p++) lote.push(totvsFetch(PRECOS, corpo(p)));
      for (const r of await Promise.all(lote)) if (r.status === 200) coletar(r.json);
    }

    // Só entram as tabelas que vieram com preço em algum produto
    const usados = new Set(Object.values(porProduto).flatMap((p) => Object.keys(p).map(Number)));
    const tabelas = ordenar(
      codigos
        .filter((c) => usados.has(c))
        .map((c) => ({ codigo: c, nome: nomes.get(c) ?? "", rotulo: rotular(nomes.get(c) ?? "", c) }))
    );
    global.__situacaoPrecos = `${Object.keys(porProduto).length} produtos com preço em ${paginas} páginas; tabelas: ${
      tabelas.map((t) => `${t.codigo}=${t.nome || "(sem nome)"}`).join(", ") || "nenhuma"
    }`;
    if (Object.keys(porProduto).length === 0) return;
    memoria = { at: Date.now(), tabelas, porProduto };
    await gravarBlob(PREFIXO, CHAVE, memoria);
  })()
    .catch((e) => {
      global.__situacaoPrecos = `falhou: ${e instanceof Error ? e.message : e}`;
      console.error("[precos]", global.__situacaoPrecos);
    })
    .finally(() => {
      global.__varreduraPrecos = null;
    });
  global.__varreduraPrecos = tarefa;
  return tarefa;
}
