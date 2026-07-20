import { ChannelResult, NormalizedOrder } from "../types";

const API = "https://api.mercadolibre.com";

// Cache em memória do token renovado (vale enquanto a instância serverless viver)
let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string | null> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.token;

  const refreshToken = process.env.ML_REFRESH_TOKEN;
  const clientId = process.env.ML_CLIENT_ID;
  const clientSecret = process.env.ML_CLIENT_SECRET;

  if (refreshToken && clientId && clientSecret) {
    const res = await fetch(`${API}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
      }),
      cache: "no-store",
    });
    if (res.ok) {
      const json = await res.json();
      cachedToken = {
        token: json.access_token,
        expiresAt: Date.now() + (json.expires_in - 300) * 1000,
      };
      return cachedToken.token;
    }
  }
  return process.env.ML_ACCESS_TOKEN ?? null;
}

interface MeliOrder {
  id: number;
  date_created: string;
  status: string;
  paid_amount: number;
  total_amount: number;
  currency_id: string;
  buyer?: { nickname?: string; first_name?: string; last_name?: string };
}

export async function fetchMeliOrders(since: Date): Promise<ChannelResult> {
  const hasCreds =
    process.env.ML_ACCESS_TOKEN ||
    (process.env.ML_REFRESH_TOKEN && process.env.ML_CLIENT_ID && process.env.ML_CLIENT_SECRET);
  if (!hasCreds) {
    return { channel: "meli", connected: false, orders: [] };
  }

  try {
    const token = await getAccessToken();
    if (!token) throw new Error("Não foi possível obter token do Mercado Livre");
    const headers = { Authorization: `Bearer ${token}` };

    const meRes = await fetch(`${API}/users/me`, { headers, cache: "no-store" });
    if (!meRes.ok) throw new Error(`Mercado Livre respondeu ${meRes.status} em /users/me (token expirado?)`);
    const me = await meRes.json();

    const orders: NormalizedOrder[] = [];
    for (let offset = 0; offset < 2000; offset += 50) {
      const url = new URL(`${API}/orders/search`);
      url.searchParams.set("seller", String(me.id));
      url.searchParams.set("order.date_created.from", since.toISOString());
      url.searchParams.set("sort", "date_desc");
      url.searchParams.set("limit", "50");
      url.searchParams.set("offset", String(offset));
      const res = await fetch(url, { headers, cache: "no-store" });
      if (!res.ok) throw new Error(`Mercado Livre respondeu ${res.status} em /orders/search`);
      const json = await res.json();
      const results: MeliOrder[] = json.results ?? [];
      for (const o of results) {
        if (o.status === "cancelled") continue;
        const buyer = o.buyer
          ? [o.buyer.first_name, o.buyer.last_name].filter(Boolean).join(" ") || o.buyer.nickname
          : undefined;
        orders.push({
          channel: "meli",
          id: String(o.id),
          label: `#${o.id}`,
          createdAt: o.date_created,
          total: o.paid_amount || o.total_amount || 0,
          currency: o.currency_id || "BRL",
          status: o.status,
          customer: buyer,
        });
      }
      if (results.length < 50) break;
    }
    return { channel: "meli", connected: true, orders };
  } catch (e) {
    return {
      channel: "meli",
      connected: true,
      error: e instanceof Error ? e.message : "Erro desconhecido",
      orders: [],
    };
  }
}
