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

const DEFAULT_URL = "https://apitotvsmoda.bhan.com.br";

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
  exitTime: string | null;
  personName: string | null;
  items?: {
    name?: string;
    quantity?: number;
    netValue?: number;
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

const cache = new Map<string, { at: number; result: ChannelResult }>();

/**
 * Vendas das lojas físicas no período (datas YYYY-MM-DD no fuso de SP).
 */
export async function fetchTotvsSales(from: string, to: string): Promise<ChannelResult> {
  if (!totvsConfigured()) {
    return { channel: "lojas", connected: false, orders: [] };
  }

  const chave = `${from}|${to}`;
  const hit = cache.get(chave);
  if (hit && Date.now() - hit.at < 5 * 60000) return hit.result;

  const orders: NormalizedOrder[] = [];
  try {
    const hoje = new Date().toISOString().slice(0, 10);
    for (const j of janelas(from, to)) {
      // A alteração acontece junto com a venda; +2 dias de folga para ajustes
      const endChange = j.end >= hoje ? hoje : j.end;
      for (let pagina = 1; pagina <= 40; pagina++) {
        const r = await totvsFetch("/api/totvsmoda/fiscal/v2/invoices/search", {
          filter: {
            branchCodeList: Object.keys(LOJAS).map(Number),
            operationType: "Output",
            change: { startDate: `${j.start}T00:00:00`, endDate: `${endChange}T23:59:59` },
          },
          expand: "items",
          page: pagina,
          pageSize: 500,
        });
        if (r.status !== 200) {
          const msg = r.json ? JSON.stringify(r.json).slice(0, 200) : r.text.slice(0, 200);
          throw new Error(`Notas fiscais: HTTP ${r.status} — ${msg}`);
        }
        const itens = (r.json?.items as TotvsInvoice[] | undefined) ?? [];
        for (const inv of itens) {
          const data = (inv.invoiceDate ?? "").slice(0, 10);
          if (data < from || data > to) continue;
          if (!isVenda(inv)) continue;
          orders.push({
            channel: "lojas",
            id: `${inv.branchCode}-${inv.invoiceSequence}`,
            label: `#${inv.invoiceCode ?? inv.invoiceSequence}`,
            createdAt: `${data}T${inv.exitTime ?? "12:00:00"}-03:00`,
            total: Number(inv.totalValue ?? 0),
            currency: "BRL",
            status: LOJAS[inv.branchCode] ?? `Filial ${inv.branchCode}`,
            customer: inv.personName ?? undefined,
            state: undefined,
            store: LOJAS[inv.branchCode] ?? `Filial ${inv.branchCode}`,
            items: (inv.items ?? [])
              .filter((it) => it.name)
              .map((it) => ({
                title: it.name!,
                qty: Number(it.quantity ?? 1),
                revenue: Number(it.netValue ?? 0),
              })),
          });
        }
        if (itens.length < 500) break;
      }
    }
    const result: ChannelResult = { channel: "lojas", connected: true, orders };
    cache.set(chave, { at: Date.now(), result });
    return result;
  } catch (e) {
    return {
      channel: "lojas",
      connected: true,
      error: e instanceof Error ? e.message : "Erro desconhecido",
      orders,
    };
  }
}
