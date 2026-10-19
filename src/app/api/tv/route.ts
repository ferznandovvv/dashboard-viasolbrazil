import { NextResponse } from "next/server";
import { fetchShopifyOrders } from "@/lib/connectors/shopify";
import { fetchMeliOrders } from "@/lib/connectors/mercadolivre";
import { fetchShopeeOrders } from "@/lib/connectors/shopee";
import { fetchTikTokOrders } from "@/lib/connectors/tiktok";
import { DailyPoint, addDays, spDateKey, spMidnight, todaySpKey } from "@/lib/types";
import { LOJAS, fetchTotvsSales } from "@/lib/connectors/totvs";

export const dynamic = "force-dynamic";

/**
 * Dados enxutos para o modo TV (rota pública): só agregados dos últimos
 * 14 dias — nenhum dado de cliente ou pedido individual. Os canais online
 * vêm somados ("online") e as lojas físicas, uma a uma ("loja:Centro"…).
 */
export async function GET() {
  const today = todaySpKey();
  const from = addDays(today, -13);
  const since = spMidnight(from);

  const [totvs, ...online] = await Promise.all([
    fetchTotvsSales(from, today),
    fetchShopifyOrders(since),
    fetchTikTokOrders(since),
    fetchMeliOrders(since),
    fetchShopeeOrders(since),
  ]);

  const dayMap = new Map<string, DailyPoint>();
  for (let i = 0; i < 14; i++) {
    const key = addDays(from, i);
    dayMap.set(key, { date: key, shopify: 0, tiktok: 0, meli: 0, shopee: 0, lojas: 0, online: 0 });
  }
  const somar = (p: DailyPoint, k: string, v: number) => {
    p[k] = ((p[k] as number) ?? 0) + v;
  };

  // Todas as lojas aparecem, mesmo sem venda hoje, na ordem das filiais
  const lojas = new Map(Object.values(LOJAS).map((nome) => [nome, { nome, total: 0, pedidos: 0 }]));
  const hoje = { online: 0, onlinePedidos: 0, lojas: 0, lojasPedidos: 0 };

  for (const r of online)
    for (const o of r.orders) {
      const k = spDateKey(o.createdAt);
      const p = dayMap.get(k);
      if (p) {
        p[o.channel] += o.total;
        somar(p, "online", o.total);
      }
      if (k === today) {
        hoje.online += o.total;
        hoje.onlinePedidos += 1;
      }
    }

  for (const o of totvs.orders) {
    const k = spDateKey(o.createdAt);
    const nome = o.store || "Outras";
    const p = dayMap.get(k);
    if (p) {
      p.lojas += o.total;
      somar(p, `loja:${nome}`, o.total);
    }
    if (k === today) {
      const l = lojas.get(nome) ?? { nome, total: 0, pedidos: 0 };
      l.total += o.total;
      l.pedidos += 1;
      lojas.set(nome, l);
      hoje.lojas += o.total;
      hoje.lojasPedidos += 1;
    }
  }

  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    today: {
      revenue: hoje.online + hoje.lojas,
      orders: hoje.onlinePedidos + hoje.lojasPedidos,
      ...hoje,
      lojasPorLoja: Array.from(lojas.values()),
      /** A TOTVS não respondeu: os valores das lojas não estão completos */
      lojasSemConexao: !totvs.connected || Boolean(totvs.error),
    },
    daily: Array.from(dayMap.values()),
  });
}
