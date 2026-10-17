/**
 * Receita do DRE, direto das vendas: lojas físicas (TOTVS) e canais online,
 * somados por mês e por unidade. Cada empresa soma as unidades que são dela.
 */

import { comCache } from "../cache";
import { fetchMeliOrders } from "../connectors/mercadolivre";
import { fetchShopeeOrders } from "../connectors/shopee";
import { fetchShopifyOrders } from "../connectors/shopify";
import { fetchTikTokOrders } from "../connectors/tiktok";
import { fetchTotvsSales } from "../connectors/totvs";
import { type ChannelResult, spDateKey, spMidnight, todaySpKey } from "../types";

const NOME_CANAL: Record<string, string> = {
  shopify: "Site",
  tiktok: "TikTok Shop",
  meli: "Mercado Livre",
  shopee: "Shopee",
};

export interface ReceitaAno {
  /** mês (YYYY-MM) → unidade → faturamento */
  porMes: Record<string, Record<string, number>>;
  /** Canais que falharam ou não estão conectados — a receita deles fica de fora */
  avisos: string[];
}

export function receitaDoAno(ano: number): Promise<ReceitaAno> {
  return comCache(`fin-receita|${ano}`, () => buscar(ano), 30 * 60000);
}

async function buscar(ano: number): Promise<ReceitaAno> {
  const hoje = todaySpKey();
  const de = `${ano}-01-01`;
  const ate = `${ano}-12-31` < hoje ? `${ano}-12-31` : hoje;
  const porMes: ReceitaAno["porMes"] = {};
  const avisos: string[] = [];
  if (de > hoje) return { porMes, avisos };

  const desde = spMidnight(de);
  const resultados: ChannelResult[] = await Promise.all([
    fetchTotvsSales(de, ate),
    fetchShopifyOrders(desde),
    fetchTikTokOrders(desde),
    fetchMeliOrders(desde),
    fetchShopeeOrders(desde),
  ]);

  for (const r of resultados) {
    const nome = r.channel === "lojas" ? "Lojas físicas" : NOME_CANAL[r.channel];
    if (!r.connected) {
      avisos.push(`${nome}: não conectado`);
      continue;
    }
    if (r.error) avisos.push(`${nome}: ${r.error}`);
    for (const o of r.orders) {
      const dia = spDateKey(o.createdAt);
      if (dia < de || dia > ate) continue;
      const unidade = r.channel === "lojas" ? o.store ?? "" : NOME_CANAL[r.channel];
      if (!unidade) continue;
      const mes = dia.slice(0, 7);
      const m = (porMes[mes] ??= {});
      m[unidade] = (m[unidade] ?? 0) + o.total;
    }
  }
  return { porMes, avisos };
}
