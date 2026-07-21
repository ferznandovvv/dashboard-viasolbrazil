import { NextResponse } from "next/server";
import { fetchShopifyOrders } from "@/lib/connectors/shopify";
import { fetchMeliOrders } from "@/lib/connectors/mercadolivre";
import { fetchTikTokOrders } from "@/lib/connectors/tiktok";
import { DailyPoint, addDays, spDateKey, spMidnight, todaySpKey } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Dados enxutos para o modo TV (rota pública): só agregados dos últimos
 * 14 dias — nenhum dado de cliente ou pedido individual.
 */
export async function GET() {
  const today = todaySpKey();
  const from = addDays(today, -13);
  const since = spMidnight(from);

  const results = await Promise.all([
    fetchShopifyOrders(since),
    fetchTikTokOrders(since),
    fetchMeliOrders(since),
  ]);

  const dayMap = new Map<string, DailyPoint>();
  for (let i = 0; i < 14; i++) {
    const key = addDays(from, i);
    dayMap.set(key, { date: key, shopify: 0, tiktok: 0, meli: 0 });
  }
  const todayTotals = { shopify: 0, tiktok: 0, meli: 0, orders: 0 };
  for (const r of results) {
    for (const o of r.orders) {
      const k = spDateKey(o.createdAt);
      const p = dayMap.get(k);
      if (p) p[o.channel] += o.total;
      if (k === today) {
        todayTotals[o.channel] += o.total;
        todayTotals.orders += 1;
      }
    }
  }

  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    today: {
      revenue: todayTotals.shopify + todayTotals.tiktok + todayTotals.meli,
      orders: todayTotals.orders,
      shopify: todayTotals.shopify,
      tiktok: todayTotals.tiktok,
      meli: todayTotals.meli,
    },
    daily: Array.from(dayMap.values()),
  });
}
