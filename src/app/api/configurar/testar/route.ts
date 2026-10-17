import { NextRequest, NextResponse } from "next/server";
import { limparCache } from "@/lib/cache";
import { getTotvsToken, totvsBaseUrl, totvsConfigured, totvsFetch } from "@/lib/connectors/totvs";
import { fetchShopifyOrders } from "@/lib/connectors/shopify";
import { fetchTikTokOrders } from "@/lib/connectors/tiktok";
import { fetchMeliOrders } from "@/lib/connectors/mercadolivre";
import { fetchShopeeOrders } from "@/lib/connectors/shopee";
import { fetchTikTokAdsSpend } from "@/lib/connectors/tiktokAds";
import { fetchMetaSpend } from "@/lib/connectors/meta";
import { addDays, todaySpKey } from "@/lib/types";
import type { ChannelResult } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Resume o resultado de um canal de vendas em uma frase. */
function canal(r: ChannelResult): { ok: boolean; mensagem: string } {
  if (!r.connected) return { ok: false, mensagem: "Faltam chaves (ou falta autorizar)." };
  if (r.error) return { ok: false, mensagem: r.error };
  return { ok: true, mensagem: `Funcionando — ${r.orders.length} pedido(s) nos últimos 7 dias.` };
}

/**
 * Testa uma integração agora, com as chaves que estão valendo, e devolve o
 * erro exato quando falha. ?id=totvs|shopify|tiktok|meli|shopee|tiktok-ads|meta
 */
export async function POST(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id") ?? "";
  limparCache(); // testa de verdade, sem resposta guardada
  const hoje = todaySpKey();
  const semana = new Date(Date.now() - 7 * 86400000);
  try {
    if (id === "totvs") {
      if (!totvsConfigured()) return NextResponse.json({ ok: false, mensagem: "Faltam chaves: Client ID, secret, usuário e senha." });
      try {
        await getTotvsToken();
      } catch (e) {
        const msg = e instanceof Error ? e.message : "erro";
        return NextResponse.json({
          ok: false,
          mensagem:
            msg === "fetch failed"
              ? `Não consegui falar com a TOTVS em ${totvsBaseUrl()} (sem internet ou endereço errado).`
              : `A TOTVS recusou o login: ${msg}. Confira Client ID e secret (tela LOGFC006) e usuário/senha.`,
        });
      }
      const r = await totvsFetch("/api/totvsmoda/fiscal/v2/invoices/search", {
        filter: { branchCodeList: [1], operationType: "Output", change: { startDate: `${hoje}T00:00:00`, endDate: `${hoje}T23:59:59` } },
        page: 1,
        pageSize: 1,
      });
      if (r.status !== 200) return NextResponse.json({ ok: false, mensagem: `Login OK, mas a busca de notas falhou: HTTP ${r.status} — ${r.text.slice(0, 200)}` });
      return NextResponse.json({ ok: true, mensagem: "Login na TOTVS OK e a busca de notas respondeu." });
    }
    if (id === "shopify") return NextResponse.json(canal(await fetchShopifyOrders(semana)));
    if (id === "tiktok") return NextResponse.json(canal(await fetchTikTokOrders(semana)));
    if (id === "meli") return NextResponse.json(canal(await fetchMeliOrders(semana)));
    if (id === "shopee") return NextResponse.json(canal(await fetchShopeeOrders(semana)));
    if (id === "tiktok-ads" || id === "meta") {
      const r = id === "meta" ? await fetchMetaSpend(addDays(hoje, -6), hoje) : await fetchTikTokAdsSpend(addDays(hoje, -6), hoje);
      if (!r.connected) return NextResponse.json({ ok: false, mensagem: "Faltam chaves (ou falta autorizar)." });
      if (r.error) return NextResponse.json({ ok: false, mensagem: r.error });
      const gasto = r.daily.reduce((s, d) => s + d.spend, 0);
      return NextResponse.json({ ok: true, mensagem: `Funcionando — gasto de R$ ${gasto.toFixed(2).replace(".", ",")} nos últimos 7 dias.` });
    }
    return NextResponse.json({ ok: false, mensagem: "Integração desconhecida." }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ ok: false, mensagem: e instanceof Error ? e.message : "Erro desconhecido" });
  }
}
