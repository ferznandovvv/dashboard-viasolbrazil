import crypto from "crypto";
import { ChannelResult, NormalizedOrder } from "../types";

const HOST = "https://open-api.tiktokglobalshop.com";
const AUTH_HOST = "https://auth.tiktok-shops.com";
const ORDERS_PATH = "/order/202309/orders/search";

/** Assinatura padrão da TikTok Shop Open API (HMAC-SHA256). */
export function tiktokSign(
  path: string,
  params: Record<string, string>,
  body: string,
  secret: string
): string {
  const sorted = Object.keys(params)
    .filter((k) => k !== "sign" && k !== "access_token")
    .sort()
    .map((k) => `${k}${params[k]}`)
    .join("");
  const input = `${secret}${path}${sorted}${body}${secret}`;
  return crypto.createHmac("sha256", secret).update(input).digest("hex");
}

// Cache em memória do access token renovado via refresh token
let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string | null> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.token;

  const appKey = process.env.TIKTOK_APP_KEY;
  const appSecret = process.env.TIKTOK_APP_SECRET;
  const refreshToken = process.env.TIKTOK_REFRESH_TOKEN;

  if (appKey && appSecret && refreshToken) {
    const url = new URL(`${AUTH_HOST}/api/v2/token/refresh`);
    url.searchParams.set("app_key", appKey);
    url.searchParams.set("app_secret", appSecret);
    url.searchParams.set("refresh_token", refreshToken);
    url.searchParams.set("grant_type", "refresh_token");
    const res = await fetch(url, { cache: "no-store" });
    if (res.ok) {
      const json = await res.json();
      if (json.code === 0 && json.data?.access_token) {
        // access_token_expire_in vem como timestamp unix (s) ou duração (s)
        const exp = Number(json.data.access_token_expire_in ?? 0);
        const expiresAt =
          exp > 1e9 ? exp * 1000 - 300000 : Date.now() + Math.max(exp - 300, 600) * 1000;
        cachedToken = { token: json.data.access_token, expiresAt };
        return cachedToken.token;
      }
    }
  }
  return process.env.TIKTOK_ACCESS_TOKEN ?? null;
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
  // Cipher é opcional: lojas locais de app próprio podem dispensá-lo
  const shopCipher = process.env.TIKTOK_SHOP_CIPHER;
  const hasToken = process.env.TIKTOK_REFRESH_TOKEN || process.env.TIKTOK_ACCESS_TOKEN;
  if (!appKey || !appSecret || !hasToken) {
    return { channel: "tiktok", connected: false, orders: [] };
  }

  const orders: NormalizedOrder[] = [];
  try {
    const accessToken = await getAccessToken();
    if (!accessToken) throw new Error("Não foi possível obter o access token do TikTok Shop");

    let pageToken = "";
    for (let page = 0; page < 20; page++) {
      const body = JSON.stringify({
        create_time_ge: Math.floor(since.getTime() / 1000),
      });
      const params: Record<string, string> = {
        app_key: appKey,
        timestamp: String(Math.floor(Date.now() / 1000)),
        ...(shopCipher ? { shop_cipher: shopCipher } : {}),
        page_size: "100",
        ...(pageToken ? { page_token: pageToken } : {}),
      };
      params.sign = tiktokSign(ORDERS_PATH, params, body, appSecret);

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
