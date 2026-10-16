/**
 * Clientes e pedidos do site (Shopify) no CRM. Pedidos pagos entram como
 * venda na "loja" Site; a cliente é identificada pelo telefone (do cadastro
 * ou do endereço), com e-mail e id da Shopify como apoio.
 *
 * O aceite de mensagens vem do consentimento de marketing por SMS que a
 * cliente deu no checkout. Quem não aceitou fica na base, mas não recebe
 * nada até aceitar numa loja.
 */

import { env } from "../env";
import "../credenciais";
import { alterarBase, hojeSp, lerBase, somarDias } from "./base";
import { registrarVenda, salvarCliente } from "./clientes";
import type { Venda } from "./tipos";
import { normalizarTelefone } from "./telefone";

const API_VERSION = "2024-10";
export const LOJA_SITE = "Site";

export function shopifyConfigured(): boolean {
  return Boolean(env("SHOPIFY_ADMIN_TOKEN"));
}

async function graphql(query: string, variables: Record<string, unknown>): Promise<Record<string, unknown>> {
  const domain = env("SHOPIFY_STORE_DOMAIN") || "totvs-ibirapuera-viasolbrazil-dc.myshopify.com";
  const res = await fetch(`https://${domain}/admin/api/${API_VERSION}/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": env("SHOPIFY_ADMIN_TOKEN") },
    body: JSON.stringify({ query, variables }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Shopify respondeu ${res.status}`);
  const json = (await res.json()) as { data?: Record<string, unknown>; errors?: { message: string }[] };
  if (json.errors?.length) throw new Error(json.errors.map((e) => e.message).join("; "));
  return json.data ?? {};
}

interface PedidoNode {
  id: string;
  name: string;
  createdAt: string;
  cancelledAt: string | null;
  currentTotalPriceSet: { shopMoney: { amount: string } };
  lineItems: { nodes: { quantity: number }[] };
  customer: {
    id: string;
    displayName: string | null;
    firstName: string | null;
    lastName: string | null;
    email: string | null;
    phone: string | null;
    smsMarketingConsent: { marketingState: string } | null;
  } | null;
  shippingAddress: { phone: string | null; name: string | null } | null;
  billingAddress: { phone: string | null; name: string | null } | null;
}

const QUERY = `
  query Pedidos($query: String!, $cursor: String) {
    orders(first: 250, query: $query, after: $cursor, sortKey: CREATED_AT) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id name createdAt cancelledAt
        currentTotalPriceSet { shopMoney { amount } }
        lineItems(first: 50) { nodes { quantity } }
        customer { id displayName firstName lastName email phone smsMarketingConsent { marketingState } }
        shippingAddress { phone name }
        billingAddress { phone name }
      }
    }
  }`;

export const progressoShopify: { rodando: boolean; etapa: string; vendasNovas: number; clientesNovos: number; clientesAtualizados: number; erro?: string; fim?: number } = {
  rodando: false,
  etapa: "",
  vendasNovas: 0,
  clientesNovos: 0,
  clientesAtualizados: 0,
};

interface PedidoLido {
  venda: Venda;
  cliente?: { nome: string; telefone?: string; email?: string; codigoShopify: string; optIn: boolean };
}

async function buscarPedidos(de: string, ate: string, limitePaginas = 60): Promise<PedidoLido[]> {
  const out: PedidoLido[] = [];
  let cursor: string | null = null;
  for (let p = 0; p < limitePaginas; p++) {
    const data = await graphql(QUERY, {
      query: `created_at:>='${de}T00:00:00-03:00' AND created_at:<='${ate}T23:59:59-03:00' AND financial_status:paid`,
      cursor,
    });
    const orders = data.orders as { pageInfo: { hasNextPage: boolean; endCursor: string }; nodes: PedidoNode[] };
    for (const n of orders.nodes) {
      if (n.cancelledAt) continue;
      const c = n.customer;
      const telefone = normalizarTelefone(c?.phone) ?? normalizarTelefone(n.shippingAddress?.phone) ?? normalizarTelefone(n.billingAddress?.phone);
      const nome = (c?.displayName || `${c?.firstName ?? ""} ${c?.lastName ?? ""}`.trim() || n.shippingAddress?.name || n.billingAddress?.name || "").trim();
      out.push({
        venda: {
          id: `shopify-${n.id.split("/").pop()}`,
          loja: LOJA_SITE,
          data: n.createdAt,
          valor: parseFloat(n.currentTotalPriceSet.shopMoney.amount),
          pecas: n.lineItems.nodes.reduce((t, li) => t + li.quantity, 0),
          nomeNaNota: nome || undefined,
          origem: "shopify",
        },
        cliente: c && nome ? { nome, telefone, email: c.email ?? undefined, codigoShopify: c.id.split("/").pop()!, optIn: c.smsMarketingConsent?.marketingState === "SUBSCRIBED" } : undefined,
      });
    }
    if (!orders.pageInfo.hasNextPage) break;
    cursor = orders.pageInfo.endCursor;
  }
  return out;
}

/** Sincroniza os pedidos do site num período. `creditar=false` para histórico. */
export async function sincronizarShopify(de: string, ate: string, opcoes: { creditar?: boolean } = {}): Promise<typeof progressoShopify> {
  if (!shopifyConfigured()) throw new Error("Shopify não está configurada (veja /configurar).");
  if (progressoShopify.rodando) throw new Error("Já tem uma sincronização da Shopify rodando.");
  Object.assign(progressoShopify, { rodando: true, etapa: "buscando pedidos", vendasNovas: 0, clientesNovos: 0, clientesAtualizados: 0, erro: undefined, fim: undefined });
  try {
    const pedidos = await buscarPedidos(de, ate);
    progressoShopify.etapa = `gravando ${pedidos.length} pedidos`;
    await alterarBase((b) => {
      const pctAntes = b.config.cashbackPct;
      if (opcoes.creditar === false || !b.config.cashbackSite) b.config.cashbackPct = 0;
      for (const { venda, cliente } of pedidos) {
        if (cliente) {
          const { cliente: c, nova } = salvarCliente(b, { ...cliente, lojaOrigem: LOJA_SITE }, "shopify");
          // Aceite de SMS dado depois do primeiro pedido também vale
          if (cliente.optIn && !c.optOut) c.optIn = true;
          venda.clienteId = c.id;
          if (nova) progressoShopify.clientesNovos++;
          else progressoShopify.clientesAtualizados++;
        }
        if (registrarVenda(b, venda)) progressoShopify.vendasNovas++;
      }
      b.config.cashbackPct = pctAntes;
      b.config.ultimaSincShopify = new Date().toISOString();
      b.config.ultimaSincShopifyResultado = `${de} a ${ate}: ${progressoShopify.vendasNovas} pedidos novos, ${progressoShopify.clientesNovos} clientes novos`;
      if (!b.config.sincShopifyDesde || de < b.config.sincShopifyDesde) b.config.sincShopifyDesde = de;
    });
    progressoShopify.etapa = "concluído";
  } catch (e) {
    progressoShopify.erro = e instanceof Error ? e.message : String(e);
    progressoShopify.etapa = "falhou";
    await alterarBase((b) => {
      b.config.ultimaSincShopifyResultado = `falhou: ${progressoShopify.erro}`;
    });
  } finally {
    progressoShopify.rodando = false;
    progressoShopify.fim = Date.now();
  }
  return progressoShopify;
}

/** Diária: últimos 3 dias. */
export async function sincronizarShopifyDiaria(): Promise<typeof progressoShopify | null> {
  if (!shopifyConfigured() || progressoShopify.rodando) return null;
  const hoje = hojeSp();
  return sincronizarShopify(somarDias(hoje, -3), hoje, { creditar: true });
}

/** Um pedido cru, para conferir se telefone e consentimento vêm (depende das permissões do app). */
export async function diagnosticoShopify(): Promise<unknown> {
  if (!shopifyConfigured()) throw new Error("Shopify não está configurada.");
  const base = await lerBase();
  const data = await graphql(QUERY.replace("first: 250", "first: 1"), { query: "financial_status:paid", cursor: null });
  const n = (data.orders as { nodes: PedidoNode[] }).nodes[0];
  return {
    pedido: n,
    lido: n ? { telefone: normalizarTelefone(n.customer?.phone) ?? normalizarTelefone(n.shippingAddress?.phone) ?? normalizarTelefone(n.billingAddress?.phone), aceiteSms: n.customer?.smsMarketingConsent?.marketingState } : null,
    cashbackSite: base.config.cashbackSite,
    aviso: "Se customer.phone e customer.email vierem null, o app da Shopify precisa da permissão read_customers (e, se for app novo, do acesso a dados protegidos de clientes).",
  };
}
