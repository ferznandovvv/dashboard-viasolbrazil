import { ChannelResult, NormalizedOrder, todaySpKey } from "../types";
import { comCache, validadeDaBusca } from "../cache";
import { gravarBlob, lerBlobs } from "../blobCache";
import { env } from "../env";
import "../credenciais"; // chaves salvas em disco, quando roda fora da Vercel

const API_VERSION = "2024-10";

/** Pedido pago, inclusive o que teve parte reembolsada (vale o valor que ficou). */
const PAGOS = "(financial_status:paid OR financial_status:partially_refunded)";

interface ShopifyOrderNode {
  id: string;
  name: string;
  createdAt: string;
  displayFinancialStatus: string | null;
  customer: { displayName: string | null } | null;
  currentTotalPriceSet: { shopMoney: { amount: string; currencyCode: string } };
  currentTotalDiscountsSet: { shopMoney: { amount: string } } | null;
  paymentGatewayNames: string[] | null;
  shippingAddress: { provinceCode: string | null } | null;
  lineItems: {
    nodes: {
      title: string;
      quantity: number;
      discountedTotalSet: { shopMoney: { amount: string } };
    }[];
  };
}

/**
 * Pedidos pagos desde `since`. Com `ate` (o ano passado, no comparativo), só
 * até esse instante, e a busca vai mais longe: o período inteiro precisa vir.
 */
export async function fetchShopifyOrders(since: Date, ate?: Date): Promise<ChannelResult> {
  return comCache(`shopify|${since.toISOString().slice(0, 10)}|${ate?.toISOString() ?? ""}`, () => buscar(since, ate), validadeDaBusca(ate), true);
}

function acesso() {
  return {
    domain: (env("SHOPIFY_STORE_DOMAIN") || undefined) ?? "totvs-ibirapuera-viasolbrazil-dc.myshopify.com",
    token: env("SHOPIFY_ADMIN_TOKEN") || undefined,
  };
}

async function buscar(since: Date, ate?: Date): Promise<ChannelResult> {
  const { domain, token } = acesso();
  if (!domain || !token) {
    return { channel: "shopify", connected: false, orders: [] };
  }

  const orders: NormalizedOrder[] = [];
  let cursor: string | null = null;

  try {
    for (let page = 0; page < (ate ? 40 : 10); page++) {
      const query = `
        query Orders($query: String!, $cursor: String) {
          orders(first: 250, query: $query, after: $cursor, sortKey: CREATED_AT, reverse: true) {
            pageInfo { hasNextPage endCursor }
            nodes {
              id
              name
              createdAt
              displayFinancialStatus
              customer { displayName }
              currentTotalPriceSet { shopMoney { amount currencyCode } }
              currentTotalDiscountsSet { shopMoney { amount } }
              paymentGatewayNames
              shippingAddress { provinceCode }
              lineItems(first: 10) {
                nodes { title quantity discountedTotalSet { shopMoney { amount } } }
              }
            }
          }
        }`;
      const res: Response = await fetch(
        `https://${domain}/admin/api/${API_VERSION}/graphql.json`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Shopify-Access-Token": token,
          },
          body: JSON.stringify({
            query,
            variables: {
              // Só pedidos efetivamente pagos — pagamento pendente não é venda. O
              // reembolsado em parte continua venda, pelo valor que ficou (current total)
              query: `created_at:>='${since.toISOString()}'${ate ? ` AND created_at:<'${ate.toISOString()}'` : ""} AND ${PAGOS}`,
              cursor,
            },
          }),
          cache: "no-store",
        }
      );
      if (!res.ok) {
        throw new Error(`Shopify respondeu ${res.status}`);
      }
      const json = await res.json();
      if (json.errors?.length) {
        throw new Error(json.errors[0].message);
      }
      const data = json.data.orders;
      for (const n of data.nodes as ShopifyOrderNode[]) {
        orders.push({
          channel: "shopify",
          id: n.id,
          label: n.name,
          createdAt: n.createdAt,
          total: parseFloat(n.currentTotalPriceSet.shopMoney.amount),
          currency: n.currentTotalPriceSet.shopMoney.currencyCode,
          status: n.displayFinancialStatus ?? "—",
          customer: n.customer?.displayName ?? undefined,
          state: n.shippingAddress?.provinceCode ?? undefined,
          qty: n.lineItems.nodes.reduce((t, li) => t + li.quantity, 0),
          discount: parseFloat(n.currentTotalDiscountsSet?.shopMoney.amount ?? "0"),
          payment: (n.paymentGatewayNames ?? [])[0] ?? undefined,
          items: n.lineItems.nodes.map((li) => ({
            title: li.title,
            qty: li.quantity,
            revenue: parseFloat(li.discountedTotalSet.shopMoney.amount),
          })),
        });
      }
      if (!data.pageInfo.hasNextPage) break;
      cursor = data.pageInfo.endCursor;
    }
    return { channel: "shopify", connected: true, orders };
  } catch (e) {
    return {
      channel: "shopify",
      connected: true,
      error: e instanceof Error ? e.message : "Erro desconhecido",
      orders,
    };
  }
}

// v2: o total do mês passou a contar o pedido reembolsado em parte (antes sumia inteiro)
const PREFIXO_MES = "shopifymes2/";

/**
 * Total pago do site num mês (AAAA-MM, no fuso de São Paulo), para o
 * histórico. Diferente da busca do painel, não para em 2.500 pedidos e só
 * traz o valor. Mês encerrado há mais de 20 dias fica guardado. Sem a
 * Shopify configurada, 0; `null` quando ela não respondeu.
 */
export async function totalShopifyDoMes(mes: string): Promise<number | null> {
  const { domain, token } = acesso();
  if (!token) return 0;
  const [ano, m] = mes.split("-").map(Number);
  const proximo = `${m === 12 ? ano + 1 : ano}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}`;
  const estavel = Date.now() - new Date(`${proximo}-01T00:00:00-03:00`).getTime() > 20 * 86400000;
  if (estavel) {
    const guardado = (await lerBlobs<{ total: number }>(PREFIXO_MES, [mes])).get(mes);
    if (guardado) return guardado.total;
  }
  if (mes > todaySpKey().slice(0, 7)) return 0;

  return comCache(`shopifymes|${mes}`, async () => {
    let total = 0;
    let cursor: string | null = null;
    try {
      for (let pagina = 0; pagina < 200; pagina++) {
        const res: Response = await fetch(`https://${domain}/admin/api/${API_VERSION}/graphql.json`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
          body: JSON.stringify({
            query: `query Mes($query: String!, $cursor: String) {
              orders(first: 250, query: $query, after: $cursor) {
                pageInfo { hasNextPage endCursor }
                nodes { currentTotalPriceSet { shopMoney { amount } } }
              }
            }`,
            variables: {
              query: `created_at:>='${mes}-01T00:00:00-03:00' AND created_at:<'${proximo}-01T00:00:00-03:00' AND ${PAGOS}`,
              cursor,
            },
          }),
          cache: "no-store",
        });
        if (!res.ok) return null;
        const json = await res.json();
        if (json.errors?.length) return null;
        const data = json.data.orders;
        for (const n of data.nodes as { currentTotalPriceSet: { shopMoney: { amount: string } } }[])
          total += parseFloat(n.currentTotalPriceSet.shopMoney.amount);
        if (!data.pageInfo.hasNextPage) break;
        cursor = data.pageInfo.endCursor;
      }
    } catch {
      return null;
    }
    total = Math.round(total * 100) / 100;
    if (estavel) await gravarBlob(PREFIXO_MES, mes, { total });
    return total;
  }, 30 * 60000);
}
