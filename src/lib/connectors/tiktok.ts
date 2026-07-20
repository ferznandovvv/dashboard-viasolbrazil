import crypto from "crypto";
import { ChannelResult, NormalizedOrder } from "../types";

const HOST = "https://open-api.tiktokglobalshop.com";
const ORDERS_PATH = "/order/202309/orders/search";

/** Assinatura padrão da TikTok Shop Open API (HMAC-SHA256). */
function sign(path: string, params: Record<string, string>, body: string, secret: string): string {
  const sorted = Object.keys(params)
    .filter((k) => k !== "sign" && k !== "access_token")
    .sort()
    .map((k) => `${k}${params[k]}`)
    .join("");
  const input = `${secret}${path}${sorted}${body}${secret}`;
  return crypto.createHmac("sha256", secret).update(input).digest("hex");
}

interface TikTokOrder {
  id: string;
  create_time: number; // epoch segundos
  status: string;
  payment?: { total_amount?: string; currency?: string };
  recipient_address?: { name?: string };
}

export async function fetchTikTokOrders(since: Date): Promise<ChannelResult> {
  const appKey = process.env.TIKTOK_APP_KEY;
  const appSecret = process.env.TIKTOK_APP_SECRET;
  const accessToken = process.env.TIKTOK_ACCESS_TOKEN;
  const shopCipher = process.env.TIKTOK_SHOP_CIPHER;
  if (!appKey || !appSecret || !accessToken || !shopCipher) {
    return { channel: "tiktok", connected: false, orders: [] };
  }

  const orders: NormalizedOrder[] = [];
  try {
    let pageToken = "";
    for (let page = 0; page < 20; page++) {
      const body = JSON.stringify({
        create_time_ge: Math.floor(since.getTime() / 1000),
      });
      const params: Record<string, string> = {
        app_key: appKey,
        timestamp: String(Math.floor(Date.now() / 1000)),
        shop_cipher: shopCipher,
        page_size: "100",
        ...(pageToken ? { page_token: pageToken } : {}),
      };
      params.sign = sign(ORDERS_PATH, params, body, appSecret);

      const url = new URL(`${HOST}${ORDERS_PATH}`);
      for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-tts-access-token": accessToken,
        },
        body,
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`TikTok Shop respondeu ${res.status}`);
      const json = await res.json();
      if (json.code !== 0) throw new Error(`TikTok Shop: ${json.message} (code ${json.code})`);

      const list: TikTokOrder[] = json.data?.orders ?? [];
      for (const o of list) {
        if (o.status === "CANCELLED") continue;
        orders.push({
          channel: "tiktok",
          id: o.id,
          label: `#${o.id.slice(-8)}`,
          createdAt: new Date(o.create_time * 1000).toISOString(),
          total: parseFloat(o.payment?.total_amount ?? "0"),
          currency: o.payment?.currency ?? "BRL",
          status: o.status,
          customer: o.recipient_address?.name,
        });
      }
      pageToken = json.data?.next_page_token ?? "";
      if (!pageToken || list.length === 0) break;
    }
    return { channel: "tiktok", connected: true, orders };
  } catch (e) {
    return {
      channel: "tiktok",
      connected: true,
      error: e instanceof Error ? e.message : "Erro desconhecido",
      orders,
    };
  }
}
