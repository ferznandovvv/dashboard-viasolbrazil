import { ChannelResult, NormalizedOrder } from "../types";
import { comCache } from "../cache";

const API_VERSION = "2024-10";

interface ShopifyOrderNode {
  id: string;
  name: string;
  createdAt: string;
  displayFinancialStatus: string | null;
  customer: { displayName: string | null } | null;
  currentTotalPriceSet: { shopMoney: { amount: string; currencyCode: string } };
  shippingAddress: { provinceCode: string | null } | null;
  lineItems: {
    nodes: {
      title: string;
      quantity: number;
      discountedTotalSet: { shopMoney: { amount: string } };
    }[];
  };
}

export async function fetchShopifyOrders(since: Date): Promise<ChannelResult> {
  return comCache(`shopify|${since.toISOString().slice(0,10)}`, () => buscar(since));
}

async function buscar(since: Date): Promise<ChannelResult> {
  const domain =
    process.env.SHOPIFY_STORE_DOMAIN ?? "totvs-ibirapuera-viasolbrazil-dc.myshopify.com";
  const token = process.env.SHOPIFY_ADMIN_TOKEN;
  if (!domain || !token) {
    return { channel: "shopify", connected: false, orders: [] };
  }

  const orders: NormalizedOrder[] = [];
  let cursor: string | null = null;

  try {
    for (let page = 0; page < 10; page++) {
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
              // Só pedidos efetivamente pagos — pagamento pendente não é venda
              query: `created_at:>='${since.toISOString()}' AND financial_status:paid`,
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
