import { NextRequest, NextResponse } from "next/server";
import { fetchShopifyOrders } from "@/lib/connectors/shopify";
import { fetchMeliOrders } from "@/lib/connectors/mercadolivre";
import { fetchTikTokOrders } from "@/lib/connectors/tiktok";
import {
  ChannelResult,
  DailyPoint,
  DashboardData,
  periodStart,
  spDateKey,
} from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const daysParam = parseInt(req.nextUrl.searchParams.get("days") ?? "30", 10);
  const days = [7, 30, 90].includes(daysParam) ? daysParam : 30;
  const since = periodStart(days);

  const results: ChannelResult[] = await Promise.all([
    fetchShopifyOrders(since),
    fetchTikTokOrders(since),
    fetchMeliOrders(since),
  ]);

  const allOrders = results
    .flatMap((r) => r.orders)
    .filter((o) => new Date(o.createdAt) >= since)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  // Série diária por canal, no fuso de São Paulo
  const dayMap = new Map<string, DailyPoint>();
  for (let i = 0; i < days; i++) {
    const key = spDateKey(new Date(since.getTime() + i * 86400000).toISOString());
    dayMap.set(key, { date: key, shopify: 0, tiktok: 0, meli: 0 });
  }
  for (const o of allOrders) {
    const p = dayMap.get(spDateKey(o.createdAt));
    if (p) p[o.channel] += o.total;
  }

  const channels = results.map((r) => ({
    channel: r.channel,
    connected: r.connected,
    error: r.error,
    revenue: r.orders.reduce((s, o) => s + o.total, 0),
    orders: r.orders.length,
  }));

  const revenue = channels.reduce((s, c) => s + c.revenue, 0);
  const orderCount = channels.reduce((s, c) => s + c.orders, 0);

  const data: DashboardData = {
    generatedAt: new Date().toISOString(),
    days,
    channels,
    totals: {
      revenue,
      orders: orderCount,
      avgTicket: orderCount > 0 ? revenue / orderCount : 0,
    },
    daily: Array.from(dayMap.values()),
    recentOrders: allOrders.slice(0, 25),
  };

  return NextResponse.json(data);
}
