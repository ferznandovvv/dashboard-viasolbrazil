/**
 * Pedidos da Shopee (Open Platform, API v2).
 *
 * Toda chamada é assinada com HMAC-SHA256 da Partner Key. O access token vale
 * 4 horas e o refresh token, 30 dias — e a Shopee troca o refresh token a cada
 * renovação, então o novo precisa ser guardado na hora (senão o próximo
 * reinício começa com um token morto).
 */

import { createHmac } from "node:crypto";
import { ChannelResult, NormalizedOrder } from "../types";
import { comCache } from "../cache";
import { env } from "../env";
import { rodandoLocal, salvarCredenciais } from "../credenciais";

export const SHOPEE_HOST = "https://partner.shopeemobile.com";
/** A lista de pedidos aceita no máximo 15 dias por consulta */
const JANELA_DIAS = 14;

/** Assinatura: partner_id + caminho + timestamp (+ access_token + shop_id nas chamadas da loja). */
export function assinarShopee(caminho: string, timestamp: number, extra = ""): string {
  const partnerId = env("SHOPEE_PARTNER_ID");
  return createHmac("sha256", env("SHOPEE_PARTNER_KEY"))
    .update(`${partnerId}${caminho}${timestamp}${extra}`)
    .digest("hex");
}

export const agora = () => Math.floor(Date.now() / 1000);

// Token compartilhado pelo processo: cada rota do Next tem suas próprias
// variáveis de módulo, e duas renovações ao mesmo tempo com o mesmo refresh
// token fariam a segunda falhar
const global = globalThis as unknown as {
  __shopeeToken?: { token: string; expiraEm: number };
  __shopeeRenovando?: Promise<string> | null;
  __shopeeRefresh?: string;
};

async function accessToken(): Promise<string> {
  const t = global.__shopeeToken;
  if (t && t.expiraEm > Date.now()) return t.token;
  if (global.__shopeeRenovando) return global.__shopeeRenovando;
  global.__shopeeRenovando = renovar().finally(() => {
    global.__shopeeRenovando = null;
  });
  return global.__shopeeRenovando;
}

async function renovar(): Promise<string> {
  const caminho = "/api/v2/auth/access_token/get";
  const ts = agora();
  const partnerId = Number(env("SHOPEE_PARTNER_ID"));
  const url = `${SHOPEE_HOST}${caminho}?partner_id=${partnerId}&timestamp=${ts}&sign=${assinarShopee(caminho, ts)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      refresh_token: global.__shopeeRefresh ?? env("SHOPEE_REFRESH_TOKEN"),
      partner_id: partnerId,
      shop_id: Number(env("SHOPEE_SHOP_ID")),
    }),
    cache: "no-store",
  });
  const j = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    refresh_token?: string;
    expire_in?: number;
    error?: string;
    message?: string;
  };
  if (!j.access_token) {
    throw new Error(
      `Shopee recusou a renovação do acesso (${j.error || res.status}: ${j.message ?? ""}). Autorize de novo em /api/shopee/setup`
    );
  }
  if (j.refresh_token) {
    global.__shopeeRefresh = j.refresh_token;
    if (rodandoLocal()) salvarCredenciais({ SHOPEE_REFRESH_TOKEN: j.refresh_token });
  }
  global.__shopeeToken = { token: j.access_token, expiraEm: Date.now() + ((j.expire_in ?? 14400) - 300) * 1000 };
  return j.access_token;
}

/** GET numa rota da loja, já assinada. */
export async function shopeeGet(caminho: string, params: Record<string, string | number>) {
  const token = await accessToken();
  const ts = agora();
  const shopId = env("SHOPEE_SHOP_ID");
  const url = new URL(`${SHOPEE_HOST}${caminho}`);
  url.searchParams.set("partner_id", env("SHOPEE_PARTNER_ID"));
  url.searchParams.set("timestamp", String(ts));
  url.searchParams.set("access_token", token);
  url.searchParams.set("shop_id", shopId);
  url.searchParams.set("sign", assinarShopee(caminho, ts, `${token}${shopId}`));
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const res = await fetch(url, { cache: "no-store" });
  const j = (await res.json().catch(() => ({}))) as { error?: string; message?: string; response?: Record<string, unknown> };
  if (j.error) throw new Error(`Shopee (${caminho.split("/").pop()}): ${j.error} — ${j.message ?? ""}`);
  return j.response ?? {};
}

export function shopeeConfigurada(): boolean {
  return Boolean(
    env("SHOPEE_PARTNER_ID") && env("SHOPEE_PARTNER_KEY") && env("SHOPEE_REFRESH_TOKEN") && env("SHOPEE_SHOP_ID")
  );
}

interface PedidoShopee {
  order_sn: string;
  create_time: number;
  order_status: string;
  total_amount?: number;
  currency?: string;
  buyer_username?: string;
  payment_method?: string;
  item_list?: {
    item_name?: string;
    model_name?: string;
    model_quantity_purchased?: number;
    model_discounted_price?: number;
  }[];
}

/** Pedido ainda não pago ou cancelado não é venda */
const FORA = new Set(["UNPAID", "CANCELLED", "IN_CANCEL"]);

export async function fetchShopeeOrders(since: Date): Promise<ChannelResult> {
  return comCache(`shopee|${since.toISOString().slice(0, 10)}`, () => buscar(since), 10 * 60000, true);
}

async function buscar(since: Date): Promise<ChannelResult> {
  if (!shopeeConfigurada()) return { channel: "shopee", connected: false, orders: [] };

  try {
    // 1) Números dos pedidos, em janelas de até 15 dias
    const numeros: string[] = [];
    const fim = agora();
    for (let de = Math.floor(since.getTime() / 1000); de < fim; de += JANELA_DIAS * 86400) {
      const ate = Math.min(de + JANELA_DIAS * 86400, fim);
      let cursor = "";
      for (let pagina = 0; pagina < 50; pagina++) {
        const r = (await shopeeGet("/api/v2/order/get_order_list", {
          time_range_field: "create_time",
          time_from: de,
          time_to: ate,
          page_size: 100,
          cursor,
        })) as { order_list?: { order_sn: string }[]; more?: boolean; next_cursor?: string };
        for (const o of r.order_list ?? []) numeros.push(o.order_sn);
        if (!r.more || !r.next_cursor) break;
        cursor = r.next_cursor;
      }
    }

    // 2) Detalhe, 50 por vez
    const orders: NormalizedOrder[] = [];
    for (let i = 0; i < numeros.length; i += 50) {
      const r = (await shopeeGet("/api/v2/order/get_order_detail", {
        order_sn_list: numeros.slice(i, i + 50).join(","),
        response_optional_fields: "buyer_username,item_list,total_amount,payment_method",
      })) as { order_list?: PedidoShopee[] };
      for (const o of r.order_list ?? []) {
        if (FORA.has(o.order_status)) continue;
        const itens = (o.item_list ?? []).filter((it) => it.item_name);
        orders.push({
          channel: "shopee",
          id: o.order_sn,
          label: `#${o.order_sn}`,
          createdAt: new Date(o.create_time * 1000).toISOString(),
          total: Number(o.total_amount ?? 0),
          currency: o.currency || "BRL",
          status: o.order_status,
          customer: o.buyer_username,
          qty: itens.reduce((t, it) => t + (it.model_quantity_purchased ?? 1), 0),
          payment: o.payment_method || "Shopee",
          items: itens.map((it) => ({
            // A variação (cor, tamanho) vem separada do nome do anúncio
            title: [it.item_name, it.model_name].filter(Boolean).join(" "),
            qty: it.model_quantity_purchased ?? 1,
            revenue: (it.model_quantity_purchased ?? 1) * (it.model_discounted_price ?? 0),
          })),
        });
      }
    }
    return { channel: "shopee", connected: true, orders };
  } catch (e) {
    return {
      channel: "shopee",
      connected: true,
      error: e instanceof Error ? e.message : "Erro desconhecido",
      orders: [],
    };
  }
}
