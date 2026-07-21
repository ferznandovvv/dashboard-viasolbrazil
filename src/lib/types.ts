export type ChannelId = "shopify" | "tiktok" | "meli";

export interface OrderItem {
  title: string;
  qty: number;
  revenue: number;
}

export interface NormalizedOrder {
  channel: ChannelId;
  id: string;
  /** Número/nome amigável do pedido (ex.: #1042) */
  label: string;
  createdAt: string; // ISO
  total: number; // em BRL
  currency: string;
  status: string;
  customer?: string;
  /** UF ou nome do estado de entrega, quando a API informa */
  state?: string;
  items?: OrderItem[];
}

export interface ChannelResult {
  channel: ChannelId;
  connected: boolean;
  /** Mensagem de erro quando a busca falhou (canal conectado, mas com problema) */
  error?: string;
  orders: NormalizedOrder[];
}

export interface DailyPoint {
  /** Data no fuso de São Paulo, formato YYYY-MM-DD */
  date: string;
  shopify: number;
  tiktok: number;
  meli: number;
}

export interface Totals {
  revenue: number;
  orders: number;
  avgTicket: number;
}

export interface DashboardData {
  generatedAt: string;
  /** Período atual (datas SP, inclusivas) */
  from: string;
  to: string;
  channels: {
    channel: ChannelId;
    connected: boolean;
    error?: string;
    revenue: number;
    orders: number;
    prevRevenue: number;
  }[];
  totals: Totals;
  /** Mesmo tamanho de janela, imediatamente anterior */
  prevTotals: Totals;
  daily: DailyPoint[];
  recentOrders: NormalizedOrder[];
  topProducts: { title: string; channel: ChannelId; qty: number; revenue: number }[];
  states: { uf: string; revenue: number; orders: number }[];
  /** Meta Ads × vendas Shopify */
  ads: {
    connected: boolean;
    error?: string;
    spend: number;
    prevSpend: number;
    /** Receita Shopify ÷ gasto (0 quando não dá pra calcular) */
    roas: number;
    /** Gasto ÷ pedidos Shopify */
    cpa: number;
    daily: { date: string; spend: number }[];
  };
  goal: {
    target: number;
    monthRevenue: number;
    pct: number;
    projection: number;
    monthLabel: string;
  } | null;
}

const SP_TZ = "America/Sao_Paulo";

/** Converte um instante para a data local de São Paulo (YYYY-MM-DD). */
export function spDateKey(iso: string): string {
  const d = new Date(iso);
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: SP_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(d);
}

/** Meia-noite de São Paulo do dia YYYY-MM-DD, como Date UTC (SP = UTC-3 fixo). */
export function spMidnight(dateKey: string): Date {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 3, 0, 0));
}

export function todaySpKey(): string {
  return spDateKey(new Date().toISOString());
}

export function addDays(dateKey: string, n: number): string {
  return spDateKey(new Date(spMidnight(dateKey).getTime() + n * 86400000 + 1000).toISOString());
}
