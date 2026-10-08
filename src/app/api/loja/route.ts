import { NextRequest, NextResponse } from "next/server";
import { LOJAS, fetchTotvsSales } from "@/lib/connectors/totvs";
import { readConfig } from "@/lib/config";
import { addDays, spDateKey, todaySpKey } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export interface Vendedora {
  nome: string;
  vendidoMes: number;
  vendidoHoje: number;
  vendasMes: number;
  meta: number;
  /** 0 a 1 (pode passar de 1) */
  pct: number;
  falta: number;
  /** Quanto precisa vender por dia, de hoje até o fim do mês */
  porDia: number;
}

/**
 * Tela da loja: meta de cada vendedora e da loja no mês.
 *
 * A meta individual é a meta da loja dividida igualmente entre as vendedoras
 * ativas — quem vendeu nessa loja nos últimos 30 dias. Contar só quem já
 * vendeu no mês faria a meta de cada uma ficar enorme no dia 1, quando só
 * duas ou três passaram pelo caixa.
 */
export async function GET(req: NextRequest) {
  const nome = (req.nextUrl.searchParams.get("nome") ?? "").trim();
  const lojas = Object.values(LOJAS);
  if (!lojas.includes(nome)) {
    return NextResponse.json({ erro: "Loja não encontrada", lojas }, { status: 400 });
  }

  const hoje = todaySpKey();
  const inicioMes = `${hoje.slice(0, 7)}-01`;
  const inicio30 = addDays(hoje, -29);
  const buscarDesde = inicio30 < inicioMes ? inicio30 : inicioMes;

  const [vendas, cfg] = await Promise.all([fetchTotvsSales(buscarDesde, hoje), readConfig()]);

  const daLoja = vendas.orders.filter((o) => o.store === nome);
  const metaLoja = cfg.metas?.[nome] ?? 0;

  // Vendedoras ativas: venderam nesta loja nos últimos 30 dias
  const ativas = new Set(
    daLoja
      .filter((o) => o.seller && spDateKey(o.createdAt) >= inicio30)
      .map((o) => o.seller as string)
  );

  const doMes = daLoja.filter((o) => spDateKey(o.createdAt) >= inicioMes);
  const vendidoLoja = doMes.reduce((s, o) => s + o.total, 0);
  const semVendedora = doMes.filter((o) => !o.seller).reduce((s, o) => s + o.total, 0);

  // Dias até o fim do mês, contando hoje
  const [ano, mes] = hoje.split("-").map(Number);
  const ultimoDia = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  const diasRestantes = ultimoDia - Number(hoje.slice(8, 10)) + 1;

  const metaCada = ativas.size > 0 ? metaLoja / ativas.size : 0;

  const vendedoras: Vendedora[] = Array.from(ativas)
    .map((v) => {
      const dela = doMes.filter((o) => o.seller === v);
      const vendidoMes = dela.reduce((s, o) => s + o.total, 0);
      const vendidoHoje = dela
        .filter((o) => spDateKey(o.createdAt) === hoje)
        .reduce((s, o) => s + o.total, 0);
      const falta = Math.max(0, metaCada - vendidoMes);
      return {
        nome: v,
        vendidoMes,
        vendidoHoje,
        vendasMes: dela.length,
        meta: metaCada,
        pct: metaCada > 0 ? vendidoMes / metaCada : 0,
        falta,
        porDia: diasRestantes > 0 ? falta / diasRestantes : 0,
      };
    })
    // Ordem alfabética: a tela fica na frente de cliente, não é placar
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));

  return NextResponse.json({
    loja: nome,
    geradoEm: new Date().toISOString(),
    mesLabel: new Date(`${inicioMes}T12:00:00`).toLocaleDateString("pt-BR", { month: "long" }),
    diasRestantes,
    metaLoja,
    vendidoLoja,
    pctLoja: metaLoja > 0 ? vendidoLoja / metaLoja : 0,
    semVendedora,
    vendedoras,
    conectado: vendas.connected,
    erro: vendas.error,
  });
}
