import { NextRequest, NextResponse } from "next/server";
import { fetchShopifyOrders } from "@/lib/connectors/shopify";
import { fetchMeliOrders } from "@/lib/connectors/mercadolivre";
import { fetchTikTokOrders } from "@/lib/connectors/tiktok";
import {
  ChannelId,
  ChannelResult,
  DailyPoint,
  DashboardData,
  NormalizedOrder,
  Totals,
  addDays,
  spDateKey,
  spMidnight,
  todaySpKey,
} from "@/lib/types";
import { readConfig } from "@/lib/config";
import { fetchMetaSpend } from "@/lib/connectors/meta";
import { fetchTikTokAdsSpend } from "@/lib/connectors/tiktokAds";
import { fetchTotvsSales } from "@/lib/connectors/totvs";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_RANGE_DAYS = 370;

function totalsOf(orders: NormalizedOrder[]): Totals {
  const revenue = orders.reduce((s, o) => s + o.total, 0);
  return {
    revenue,
    orders: orders.length,
    avgTicket: orders.length > 0 ? revenue / orders.length : 0,
  };
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const today = todaySpKey();

  // Período: ?from=YYYY-MM-DD&to=YYYY-MM-DD (customizado) ou ?days=7|30|90
  let from = sp.get("from") ?? "";
  let to = sp.get("to") ?? "";
  const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
  if (!isDate(from) || !isDate(to) || from > to) {
    const daysParam = parseInt(sp.get("days") ?? "30", 10);
    const days = [7, 30, 90].includes(daysParam) ? daysParam : 30;
    to = today;
    from = addDays(today, -(days - 1));
  }
  if (to > today) to = today;
  const windowDays = Math.min(
    MAX_RANGE_DAYS,
    Math.round((spMidnight(to).getTime() - spMidnight(from).getTime()) / 86400000) + 1
  );
  from = addDays(to, -(windowDays - 1));

  // Janela anterior de mesmo tamanho, para o comparativo
  const prevTo = addDays(from, -1);
  const prevFrom = addDays(from, -windowDays);

  // Mês corrente (para a meta)
  const monthStart = `${today.slice(0, 7)}-01`;

  // Uma busca só, cobrindo tudo que precisamos
  const fetchStartKey = [prevFrom, monthStart, from].sort()[0];
  const fetchStart = spMidnight(fetchStartKey);

  const [shopifyRes, tiktokRes, meliRes, lojasRes, adsRes, ttAdsRes] = await Promise.all([
    fetchShopifyOrders(fetchStart),
    fetchTikTokOrders(fetchStart),
    fetchMeliOrders(fetchStart),
    fetchTotvsSales(fetchStartKey, to),
    fetchMetaSpend(prevFrom, to),
    fetchTikTokAdsSpend(prevFrom, to),
  ]);
  const results: ChannelResult[] = [shopifyRes, tiktokRes, meliRes, lojasRes];

  // Filtro opcional por canal (?channel=shopify|tiktok|meli) — os cards de
  // canal continuam mostrando os três; o resto do dashboard respeita o filtro.
  const channelParam = sp.get("channel") as ChannelId | null;
  const channelFilter: ChannelId | null =
    channelParam && ["shopify", "tiktok", "meli", "lojas"].includes(channelParam)
      ? channelParam
      : null;
  const storeFilter = sp.get("store") ?? "";
  const filteredResults = channelFilter
    ? results.filter((r) => r.channel === channelFilter)
    : results;

  const all = filteredResults
    .flatMap((r) => r.orders)
    .filter((o) => !storeFilter || o.store === storeFilter);
  const allChannels = results.flatMap((r) => r.orders);
  const inWindow = (o: NormalizedOrder, a: string, b: string) => {
    const k = spDateKey(o.createdAt);
    return k >= a && k <= b;
  };

  const current = all
    .filter((o) => inWindow(o, from, to))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const previous = all.filter((o) => inWindow(o, prevFrom, prevTo));

  // Série diária
  const dayMap = new Map<string, DailyPoint>();
  for (let i = 0; i < windowDays; i++) {
    const key = addDays(from, i);
    dayMap.set(key, { date: key, shopify: 0, tiktok: 0, meli: 0, lojas: 0 });
  }
  for (const o of current) {
    const p = dayMap.get(spDateKey(o.createdAt));
    if (!p) continue;
    p[o.channel] = (p[o.channel] as number) + o.total;
    if (o.store) p[`loja:${o.store}`] = ((p[`loja:${o.store}`] as number) ?? 0) + o.total;
  }

  const channels = results.map((r) => {
    const escopo = r.orders.filter((o) => !storeFilter || o.store === storeFilter);
    const cur = escopo.filter((o) => inWindow(o, from, to));
    const prev = escopo.filter((o) => inWindow(o, prevFrom, prevTo));
    return {
      channel: r.channel,
      connected: r.connected,
      error: r.error,
      revenue: cur.reduce((s, o) => s + o.total, 0),
      orders: cur.length,
      prevRevenue: prev.reduce((s, o) => s + o.total, 0),
    };
  });

  // Top produtos do período
  const prodMap = new Map<string, { title: string; channel: string; qty: number; revenue: number }>();
  for (const o of current) {
    for (const it of o.items ?? []) {
      const title = it.title.trim().slice(0, 80);
      const key = title.toLowerCase();
      const e = prodMap.get(key) ?? { title, channel: o.channel, qty: 0, revenue: 0 };
      e.qty += it.qty;
      e.revenue += it.revenue;
      prodMap.set(key, e);
    }
  }
  const topProducts = Array.from(prodMap.values())
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 8) as DashboardData["topProducts"];

  // Vendas por estado
  const NAME_TO_UF: Record<string, string> = {
    "sao paulo": "SP", "são paulo": "SP", "rio de janeiro": "RJ", "minas gerais": "MG",
    "bahia": "BA", "parana": "PR", "paraná": "PR", "rio grande do sul": "RS",
    "santa catarina": "SC", "pernambuco": "PE", "ceara": "CE", "ceará": "CE",
    "goias": "GO", "goiás": "GO", "distrito federal": "DF", "espirito santo": "ES",
    "espírito santo": "ES", "mato grosso": "MT", "mato grosso do sul": "MS",
    "amazonas": "AM", "para": "PA", "pará": "PA", "maranhao": "MA", "maranhão": "MA",
    "paraiba": "PB", "paraíba": "PB", "rio grande do norte": "RN", "alagoas": "AL",
    "sergipe": "SE", "piaui": "PI", "piauí": "PI", "tocantins": "TO", "rondonia": "RO",
    "rondônia": "RO", "acre": "AC", "amapa": "AP", "amapá": "AP", "roraima": "RR",
  };
  const stMap = new Map<string, { uf: string; revenue: number; orders: number }>();
  for (const o of current) {
    let uf = (o.state ?? "").trim();
    if (uf.length > 2) uf = NAME_TO_UF[uf.toLowerCase()] ?? uf;
    uf = uf ? uf.toUpperCase().slice(0, 20) : "Não informado";
    const e = stMap.get(uf) ?? { uf, revenue: 0, orders: 0 };
    e.revenue += o.total;
    e.orders += 1;
    stMap.set(uf, e);
  }
  const states = Array.from(stMap.values())
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 10);

  // Faturamento por loja física (sempre todas as lojas, ignorando o filtro)
  const lojasTodas = lojasRes.orders;
  const lojaMap = new Map<string, { name: string; revenue: number; orders: number; prevRevenue: number }>();
  for (const o of lojasTodas) {
    if (!o.store) continue;
    const e =
      lojaMap.get(o.store) ?? { name: o.store, revenue: 0, orders: 0, prevRevenue: 0 };
    if (inWindow(o, from, to)) {
      e.revenue += o.total;
      e.orders += 1;
    } else if (inWindow(o, prevFrom, prevTo)) {
      e.prevRevenue += o.total;
    }
    lojaMap.set(o.store, e);
  }
  const stores = Array.from(lojaMap.values()).sort((a, b) => b.revenue - a.revenue);

  // Meta mensal: configurável pelo sistema (Blob) com fallback na env.
  // A meta é sempre da empresa toda — ignora o filtro de canal.
  const cfg = await readConfig();
  const target = cfg.metaMensal ?? parseFloat(process.env.META_MENSAL ?? "") ?? 0;
  const monthOrders = allChannels.filter((o) => {
    const k = spDateKey(o.createdAt);
    return k >= monthStart && k <= today;
  });
  const monthRevenue = monthOrders.reduce((s, o) => s + o.total, 0);
  const dayOfMonth = parseInt(today.slice(8), 10);
  const [yy, mm] = today.split("-").map(Number);
  const daysInMonth = new Date(yy, mm, 0).getDate();
  const goal: DashboardData["goal"] = {
    target: target > 0 ? target : 0,
    monthRevenue,
    pct: target > 0 ? Math.min(monthRevenue / target, 9.99) : 0,
    projection: (monthRevenue / dayOfMonth) * daysInMonth,
    monthLabel: new Intl.DateTimeFormat("pt-BR", {
      month: "long",
      timeZone: "America/Sao_Paulo",
    }).format(spMidnight(today)),
  };

  // Meta Ads × Shopify
  const shopifyCh = channels.find((c) => c.channel === "shopify");
  const adsCurrent = adsRes.daily.filter((d) => d.date >= from && d.date <= to);
  const adsPrev = adsRes.daily.filter((d) => d.date >= prevFrom && d.date <= prevTo);
  const spend = adsCurrent.reduce((s, d) => s + d.spend, 0);
  const ads: DashboardData["ads"] = {
    connected: adsRes.connected,
    error: adsRes.error,
    spend,
    prevSpend: adsPrev.reduce((s, d) => s + d.spend, 0),
    roas: spend > 0 ? (shopifyCh?.revenue ?? 0) / spend : 0,
    cpa: (shopifyCh?.orders ?? 0) > 0 ? spend / shopifyCh!.orders : 0,
    daily: adsCurrent,
  };

  // TikTok Ads × TikTok Shop
  const tiktokCh = channels.find((c) => c.channel === "tiktok");
  const ttCurrent = ttAdsRes.daily.filter((d) => d.date >= from && d.date <= to);
  const ttPrev = ttAdsRes.daily.filter((d) => d.date >= prevFrom && d.date <= prevTo);
  const ttSpend = ttCurrent.reduce((s, d) => s + d.spend, 0);
  const tiktokAds: DashboardData["tiktokAds"] = {
    connected: ttAdsRes.connected,
    error: ttAdsRes.error,
    spend: ttSpend,
    prevSpend: ttPrev.reduce((s, d) => s + d.spend, 0),
    roas: ttSpend > 0 ? (tiktokCh?.revenue ?? 0) / ttSpend : 0,
    cpa: (tiktokCh?.orders ?? 0) > 0 ? ttSpend / tiktokCh!.orders : 0,
    daily: ttCurrent,
  };

  const data: DashboardData = {
    generatedAt: new Date().toISOString(),
    from,
    to,
    channels,
    totals: totalsOf(current),
    prevTotals: totalsOf(previous),
    daily: Array.from(dayMap.values()),
    recentOrders: current.slice(0, 25),
    topProducts,
    states,
    stores,
    ads,
    tiktokAds,
    goal,
  };

  return NextResponse.json(data);
}
