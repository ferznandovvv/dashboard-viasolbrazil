/**
 * TOTVS Moda (Virtual Age) — API de Integração V2.
 * Autenticação por senha (grant_type=password) usando o usuário de API
 * (LOGFC006) + um usuário do sistema (ADMFM026).
 *
 * As vendas das lojas físicas saem das notas fiscais de saída (NFC-e do PDV).
 * A API não filtra por data de emissão — só por data de alteração (`change`,
 * limitada a 6 meses por consulta) — então filtramos a emissão no código.
 */

import { ChannelResult, NormalizedOrder } from "../types";
import { comCache } from "../cache";
import { gravarBlob, lerBlobs } from "../blobCache";

const DEFAULT_URL = "https://apitotvsmoda.bhan.com.br";
const INVOICES = "/api/totvsmoda/fiscal/v2/invoices/search";

/** Filiais das lojas físicas (a 4 é o site, que já vem pela Shopify). */
export const LOJAS: Record<number, string> = {
  1: "Centro",
  2: "Franca Shopping",
  3: "Loja de Fábrica",
  5: "Rio de Janeiro",
  6: "Ribeirão Preto",
  7: "SP — Itaim",
  8: "Belo Horizonte",
  9: "Praia Grande",
};

export function totvsBaseUrl(): string {
  return (process.env.TOTVS_API_URL ?? DEFAULT_URL).replace(/\/$/, "");
}

export function totvsConfigured(): boolean {
  return Boolean(
    process.env.TOTVS_CLIENT_ID &&
      process.env.TOTVS_CLIENT_SECRET &&
      process.env.TOTVS_USERNAME &&
      process.env.TOTVS_PASSWORD
  );
}

let cachedToken: { token: string; expiresAt: number } | null = null;

/** Token de acesso da APIv2, com cache em memória. */
export async function getTotvsToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.token;

  const res = await fetch(`${totvsBaseUrl()}/api/totvsmoda/authorization/v2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "password",
      client_id: process.env.TOTVS_CLIENT_ID!,
      client_secret: process.env.TOTVS_CLIENT_SECRET!,
      username: process.env.TOTVS_USERNAME!,
      password: process.env.TOTVS_PASSWORD!,
    }),
    cache: "no-store",
  });

  const text = await res.text();
  let json: { access_token?: string; expires_in?: number; message?: string; error?: string } = {};
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Resposta inesperada do token (${res.status}): ${text.slice(0, 200)}`);
  }
  if (!res.ok || !json.access_token) {
    throw new Error(
      `Falha na autenticação (${res.status}): ${json.message ?? json.error ?? text.slice(0, 200)}`
    );
  }

  cachedToken = {
    token: json.access_token,
    expiresAt: Date.now() + ((json.expires_in ?? 3600) - 300) * 1000,
  };
  return cachedToken.token;
}

/** Chamada autenticada à APIv2. */
export async function totvsFetch(
  path: string,
  body?: unknown
): Promise<{ status: number; json: Record<string, unknown> | null; text: string }> {
  const token = await getTotvsToken();
  const res = await fetch(`${totvsBaseUrl()}${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    cache: "no-store",
  });
  const text = await res.text();
  let json: Record<string, unknown> | null = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* resposta não-JSON: devolvemos o texto cru para diagnóstico */
  }
  return { status: res.status, json, text };
}

interface TotvsInvoice {
  branchCode: number;
  invoiceDate: string;
  invoiceSequence: number;
  invoiceCode: number | null;
  invoiceStatus: string;
  operationType: string;
  /** Sim, o nome do campo vem com esse typo na API */
  operatioName: string;
  totalValue: number;
  quantity?: number;
  /** CPF da vendedora que fez a venda no PDV */
  sellerCpf?: string | null;
  paymentConditionName?: string | null;
  exitTime: string | null;
  personName: string | null;
  items?: {
    name?: string;
    quantity?: number;
    netValue?: number;
    products?: { discountValue?: number }[];
  }[];
}

/** Só conta venda de verdade: saída, emitida e de operação de venda. */
function isVenda(inv: TotvsInvoice): boolean {
  if (inv.operationType !== "Output") return false;
  if (inv.invoiceStatus !== "Issued") return false;
  const op = inv.operatioName ?? "";
  if (!/VENDA/i.test(op)) return false;
  return !/DEVOL|TRANSF|REMESSA|BONIFIC|BRINDE|COMODATO|AMOSTRA/i.test(op);
}

/** Quebra o período em janelas de até 6 meses (limite da API). */
function janelas(from: string, to: string): { start: string; end: string }[] {
  const out: { start: string; end: string }[] = [];
  let cursor = new Date(`${from}T00:00:00Z`);
  const fim = new Date(`${to}T00:00:00Z`);
  while (cursor <= fim) {
    const prox = new Date(cursor);
    prox.setUTCDate(prox.getUTCDate() + 150); // ~5 meses, com folga
    const end = prox > fim ? fim : prox;
    out.push({ start: cursor.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) });
    cursor = new Date(end);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

const PESSOAS = "/api/totvsmoda/person/v2/individuals/search";

/** Nome curto e legível: primeiro nome + um sobrenome. */
function nomeCurto(completo: string): string {
  const partes = completo.trim().split(/\s+/).filter((p) => p.length > 2);
  if (partes.length <= 2) return completo.trim();
  return `${partes[0]} ${partes[1]}`;
}

/**
 * Traduz o CPF gravado na nota para o nome da vendedora.
 * O cadastro de vendedor (seller/v2) não traz CPF, então a ponte é o
 * cadastro de pessoa física, consultado em lotes e guardado em cache.
 */
const nomePorCpf = new Map<string, string>();

async function nomearVendedoras(orders: NormalizedOrder[]): Promise<void> {
  const faltando = Array.from(
    new Set(
      orders
        .map((o) => o.sellerCpf)
        .filter((c): c is string => Boolean(c) && !nomePorCpf.has(c!))
    )
  );

  /** Consulta um lote de CPFs; devolve os que continuaram sem nome. */
  const buscar = async (lista: string[], filtroExtra: Record<string, unknown>) => {
    const restantes: string[] = [];
    for (let i = 0; i < lista.length; i += 50) {
      const lote = lista.slice(i, i + 50);
      try {
        const r = await totvsFetch(PESSOAS, {
          filter: { cpfList: lote, ...filtroExtra },
          page: 1,
          pageSize: 100,
        });
        const itens = (r.json?.items as { cpf?: string; name?: string }[] | undefined) ?? [];
        for (const p of itens) {
          if (p.cpf && p.name) nomePorCpf.set(p.cpf, nomeCurto(p.name));
        }
      } catch {
        /* lote sem resposta: os CPFs seguem para a próxima tentativa */
      }
      restantes.push(...lote.filter((c) => !nomePorCpf.has(c)));
    }
    return restantes;
  };

  // Vendedora que saiu da empresa fica inativa e some da busca padrão,
  // então quem não resolver na primeira passada é procurado entre as inativas.
  const semNome = await buscar(faltando, {});
  if (semNome.length) await buscar(semNome, { personIsInactive: true });

  // Sem nome no cadastro, a vendedora ainda é uma pessoa distinta: identificamos
  // pelo CPF mascarado para não perder a separação no ranking.
  for (const o of orders) {
    if (!o.sellerCpf) continue;
    o.seller = nomePorCpf.get(o.sellerCpf) ?? `CPF ${mascaraCpf(o.sellerCpf)}`;
  }
}

/** Mostra só o miolo do CPF, o suficiente para identificar sem expor o número. */
function mascaraCpf(cpf: string): string {
  const d = cpf.replace(/\D/g, "").padStart(11, "0");
  return `•••.${d.slice(3, 6)}.${d.slice(6, 9)}-••`;
}

/**
 * Vendas das lojas físicas no período (datas YYYY-MM-DD no fuso de SP).
 */
export async function fetchTotvsSales(from: string, to: string): Promise<ChannelResult> {
  if (!totvsConfigured()) {
    return { channel: "lojas", connected: false, orders: [] };
  }
  return comCache(`totvs|${from}|${to}`, () => porMeses(from, to), 5 * 60000);
}

const PREFIXO = "totvs/mes-";

/** Lista de meses (YYYY-MM) tocados pelo período. */
function mesesDo(from: string, to: string): string[] {
  const out: string[] = [];
  let [ano, mes] = from.slice(0, 7).split("-").map(Number);
  const limite = to.slice(0, 7);
  for (;;) {
    const chave = `${ano}-${String(mes).padStart(2, "0")}`;
    out.push(chave);
    if (chave >= limite) break;
    mes += 1;
    if (mes > 12) {
      mes = 1;
      ano += 1;
    }
  }
  return out;
}

/** Último dia do mês YYYY-MM. */
function fimDoMes(mes: string): string {
  const [ano, m] = mes.split("-").map(Number);
  return new Date(Date.UTC(ano, m, 0)).toISOString().slice(0, 10);
}

/**
 * Busca mês a mês, guardando no Blob os meses já encerrados — eles não mudam
 * mais, então o período longo passa a ser leitura de cache em vez de centenas
 * de páginas de API.
 */
async function porMeses(from: string, to: string): Promise<ChannelResult> {
  const hoje = new Date().toISOString().slice(0, 10);
  const meses = mesesDo(from, to);
  // Um mês só é considerado estável 20 dias depois de encerrado, tempo de
  // sobra para ajustes e cancelamentos entrarem no ERP
  const estavel = (mes: string) => {
    const fim = fimDoMes(mes);
    return fim < hoje && new Date(hoje).getTime() - new Date(fim).getTime() > 20 * 86400000;
  };

  const guardados = await lerBlobs<NormalizedOrder[]>(
    PREFIXO,
    meses.filter(estavel)
  );

  const erros: string[] = [];
  const partes = await Promise.all(
    meses.map(async (mes) => {
      const salvo = guardados.get(mes);
      if (salvo) return salvo;
      const inicio = `${mes}-01`;
      const fim = fimDoMes(mes);
      const limite = fim > hoje ? hoje : fim;
      const margem = new Date(new Date(limite).getTime() + 25 * 86400000)
        .toISOString()
        .slice(0, 10);
      const r = await buscarTotvs(inicio, limite, margem);
      if (r.error) erros.push(r.error);
      else if (estavel(mes)) await gravarBlob(PREFIXO, mes, r.orders);
      return r.orders;
    })
  );

  const orders = partes.flat().filter((o) => {
    const dia = o.createdAt.slice(0, 10);
    return dia >= from && dia <= to;
  });
  return {
    channel: "lojas",
    connected: true,
    error: erros[0],
    orders: orders.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  };
}

/**
 * `from`/`to` recortam a data de emissão; `changeAte` estende a janela de
 * alteração, porque a API só filtra por alteração e uma nota do fim do mês
 * costuma ser alterada no mês seguinte.
 */
async function buscarTotvs(from: string, to: string, changeAte = to): Promise<ChannelResult> {
  const orders: NormalizedOrder[] = [];
  try {
    const hoje = new Date().toISOString().slice(0, 10);
    const PAGE = 100; // limite da API
    const corpo = (j: { start: string; end: string }, pagina: number) => ({
      filter: {
        branchCodeList: Object.keys(LOJAS).map(Number),
        operationType: "Output",
        change: {
          startDate: `${j.start}T00:00:00`,
          endDate: `${(j.end >= hoje ? hoje : j.end)}T23:59:59`,
        },
      },
      expand: "items",
      page: pagina,
      pageSize: PAGE,
    });

    const coletar = (itens: TotvsInvoice[]) => {
      for (const inv of itens) {
        const data = (inv.invoiceDate ?? "").slice(0, 10);
        if (data < from || data > to) continue;
        if (!isVenda(inv)) continue;
        const loja = LOJAS[inv.branchCode] ?? `Filial ${inv.branchCode}`;
        orders.push({
          channel: "lojas",
          id: `${inv.branchCode}-${inv.invoiceSequence}`,
          label: `#${inv.invoiceCode ?? inv.invoiceSequence}`,
          createdAt: `${data}T${inv.exitTime ?? "12:00:00"}-03:00`,
          total: Number(inv.totalValue ?? 0),
          currency: "BRL",
          status: loja,
          customer: inv.personName ?? undefined,
          store: loja,
          qty: Number(inv.quantity ?? 0),
          discount: (inv.items ?? []).reduce(
            (t, it) => t + (it.products ?? []).reduce((s2, pr) => s2 + Number(pr.discountValue ?? 0), 0),
            0
          ),
          payment: inv.paymentConditionName ?? undefined,
          sellerCpf: inv.sellerCpf ?? undefined,
          items: (inv.items ?? [])
            .filter((it) => it.name)
            .map((it) => ({
              title: it.name!,
              qty: Number(it.quantity ?? 1),
              revenue: Number(it.netValue ?? 0),
            })),
        });
      }
    };

    for (const j of janelas(from, changeAte > hoje ? hoje : changeAte)) {
      const primeira = await totvsFetch(INVOICES, corpo(j, 1));
      if (primeira.status !== 200) {
        const msg = primeira.json
          ? JSON.stringify(primeira.json).slice(0, 200)
          : primeira.text.slice(0, 200);
        throw new Error(`Notas fiscais: HTTP ${primeira.status} — ${msg}`);
      }
      coletar((primeira.json?.items as TotvsInvoice[] | undefined) ?? []);
      const total = Number(primeira.json?.count ?? 0);
      const paginas = Math.min(Math.ceil(total / PAGE), 200);

      // Demais páginas em lotes paralelos, para não estourar o tempo da rota
      for (let inicio = 2; inicio <= paginas; inicio += 6) {
        const lote = [];
        for (let p = inicio; p < inicio + 6 && p <= paginas; p++) {
          lote.push(totvsFetch(INVOICES, corpo(j, p)));
        }
        for (const r of await Promise.all(lote)) {
          if (r.status === 200) coletar((r.json?.items as TotvsInvoice[] | undefined) ?? []);
        }
      }
    }

    await nomearVendedoras(orders);
    return { channel: "lojas", connected: true, orders };
  } catch (e) {
    return {
      channel: "lojas",
      connected: true,
      error: e instanceof Error ? e.message : "Erro desconhecido",
      orders,
    };
  }
}
