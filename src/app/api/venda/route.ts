import { NextRequest, NextResponse } from "next/server";
import { fetchShopifyOrders } from "@/lib/connectors/shopify";
import { fetchTotvsSales } from "@/lib/connectors/totvs";
import { addDays, spMidnight } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Uma venda com os produtos. A lista de vendas da loja vem sem os itens
 * (pesam muito na TOTVS), então eles são buscados só quando alguém abre a
 * venda: uma consulta ao dia da nota, só na filial dela. Pedido do site
 * (shopify-<número>, como o CRM guarda) vem da Shopify, com o tamanho.
 */
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id") ?? "";
  const data = req.nextUrl.searchParams.get("data") ?? "";
  const pedido = /^shopify-(\d+)$/.exec(id)?.[1];
  if (pedido && /^\d{4}-\d{2}-\d{2}$/.test(data)) {
    // Um dia de folga para cada lado: o CRM guarda a hora do pedido em UTC
    const r = await fetchShopifyOrders(spMidnight(addDays(data, -1)), spMidnight(addDays(data, 2)));
    const venda = r.orders.find((o) => o.id.endsWith(`/${pedido}`));
    if (!venda) return NextResponse.json({ erro: r.error ?? "Pedido não encontrado na Shopify" }, { status: 404 });
    return NextResponse.json({ venda });
  }
  const filial = /^(?:dev-)?(\d+)-\d+$/.exec(id)?.[1];
  if (!filial || !/^\d{4}-\d{2}-\d{2}$/.test(data)) {
    return NextResponse.json({ erro: "Venda inválida" }, { status: 400 });
  }
  const r = await fetchTotvsSales(data, data, { itens: true, filiais: [Number(filial)] });
  const venda = r.orders.find((o) => o.id === id);
  if (!venda) return NextResponse.json({ erro: r.error ?? "Venda não encontrada na TOTVS" }, { status: 404 });
  // O CPF da vendedora só serve para achar o nome; não vai para a tela
  const { sellerCpf: _cpf, ...semCpf } = venda;
  return NextResponse.json({ venda: semCpf });
}
