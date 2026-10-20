export type ChannelId = "shopify" | "tiktok" | "meli" | "shopee" | "lojas";

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
  /** Peças vendidas no pedido */
  qty?: number;
  /** Desconto concedido em R$ */
  discount?: number;
  /** Forma/condição de pagamento */
  payment?: string;
  /** UF ou nome do estado de entrega, quando a API informa */
  state?: string;
  /** Loja física de origem (canal lojas) */
  store?: string;
  /** CPF da vendedora, como vem da nota fiscal */
  sellerCpf?: string;
  /** Nome da vendedora, já traduzido a partir do CPF */
  seller?: string;
  items?: OrderItem[];
  /**
   * Devolução de venda (troca ou devolução na loja física): entra com valor e
   * peças negativos, na data da devolução, para o faturamento ficar líquido.
   * Não conta como pedido. A vendedora é a da venda original, quando dá para achar.
   */
  devolucao?: boolean;
}

/** Conta como pedido/venda (devolução só desconta valor e peças). */
export const contaComoPedido = (o: NormalizedOrder) => !o.devolucao;

/** Quantos pedidos de verdade tem a lista (sem as devoluções). */
export const pedidosEm = (lista: NormalizedOrder[]) => lista.reduce((n, o) => n + (o.devolucao ? 0 : 1), 0);

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
  shopee: number;
  lojas: number;
  /** Uma chave por loja física: "loja:Centro" etc. */
  [serie: string]: number | string;
}

export interface Totals {
  revenue: number;
  orders: number;
  avgTicket: number;
  /** Peças vendidas e peças por venda (PA) */
  pieces: number;
  avgPieces: number;
  /** Desconto concedido no período */
  discount: number;
}

export interface DashboardData {
  /** Resposta rápida, ainda sem as lojas físicas */
  partial?: boolean;
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
    /** Mesmo período do ano passado */
    prevRevenue: number;
    /** O ano passado veio da planilha, proporcional aos dias */
    prevEstimado?: boolean;
  }[];
  totals: Totals;
  /** Mesmo período do ano passado, no mesmo recorte */
  prevTotals: Totals;
  /**
   * O "anterior" é o mesmo período do ano passado. Sem o sistema naquela
   * época, vale a planilha antiga (só tem o total do mês: mês pela metade é
   * proporcional aos dias, e aí `estimado`, que vale para o total do
   * recorte). Com planilha no recorte, pedidos e ticket do ano passado não
   * existem e ficam zerados.
   */
  comparacao: { de: string; ate: string; daPlanilha: boolean; estimado: boolean };
  daily: DailyPoint[];
  recentOrders: NormalizedOrder[];
  topProducts: { title: string; channel: ChannelId; qty: number; revenue: number }[];
  /** Mesmos produtos em agrupamentos alternativos */
  products: Record<
    "modelo" | "cor" | "tamanho" | "completo" | "porCor" | "porTamanho",
    { title: string; channel: ChannelId; qty: number; revenue: number }[]
  >;
  states: { uf: string; revenue: number; orders: number }[];
  /** Faturamento por loja física no período */
  stores: { name: string; revenue: number; orders: number; prevRevenue: number; prevEstimado?: boolean }[];
  /** TikTok Ads × vendas TikTok Shop */
  tiktokAds: {
    connected: boolean;
    error?: string;
    spend: number;
    prevSpend: number;
    roas: number;
    cpa: number;
    daily: { date: string; spend: number }[];
  };
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
  /** Faturamento do mês corrente por unidade ("Site" e cada loja) */
  monthByUnit: Record<string, number>;
  /** Metas mensais configuradas por unidade */
  metas: Record<string, number>;
  /** Clima diário da unidade em foco */
  weather: { date: string; tmax: number; tmin: number; chuva: number; codigo: number; sol?: number }[];
  /** Faturamento por forma de pagamento */
  payments: { name: string; revenue: number; orders: number }[];
  /** Envios sem cobrança do TikTok (amostras para afiliadas) */
  affiliates: {
    shipments: number;
    pieces: number;
    prevShipments: number;
    products: { title: string; qty: number }[];
  };
  /** Ranking das vendedoras das lojas físicas no período */
  sellers: {
    name: string;
    revenue: number;
    orders: number;
    pieces: number;
    avgTicket: number;
    avgPieces: number;
    /** Lojas em que ela vendeu no período */
    stores: string[];
  }[];
  /** Vendas por dia da semana × hora */
  hours: { dow: number; hour: number; revenue: number; orders: number }[];
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
