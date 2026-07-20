export type ChannelId = "shopify" | "tiktok" | "meli";

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

export interface DashboardData {
  generatedAt: string;
  days: number;
  channels: {
    channel: ChannelId;
    connected: boolean;
    error?: string;
    revenue: number;
    orders: number;
  }[];
  totals: { revenue: number; orders: number; avgTicket: number };
  daily: DailyPoint[];
  recentOrders: NormalizedOrder[];
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

/** Início do período: hoje (SP) menos N-1 dias, à meia-noite SP, como Date UTC. */
export function periodStart(days: number): Date {
  const now = new Date();
  const todayKey = spDateKey(now.toISOString());
  const [y, m, d] = todayKey.split("-").map(Number);
  // Meia-noite de São Paulo (UTC-3, sem horário de verão desde 2019)
  const startOfToday = Date.UTC(y, m - 1, d, 3, 0, 0);
  return new Date(startOfToday - (days - 1) * 86400000);
}
