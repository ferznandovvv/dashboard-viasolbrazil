import { NextResponse } from "next/server";
import "@/lib/credenciais"; // chaves salvas em disco, quando roda fora da Vercel
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

const GRAPH = "https://graph.facebook.com/v21.0";
const TT_API = "https://business-api.tiktok.com/open_api/v1.3";
const META_PADRAO = "804350203009075";

function fim(token: string): string {
  return token ? `presente (${token.length} caracteres, termina em …${token.slice(-4)})` : "AUSENTE";
}

async function json(url: string, init?: RequestInit) {
  const r = await fetch(url, { cache: "no-store", ...init });
  return { status: r.status, j: await r.json().catch(() => ({})) };
}

/**
 * Diagnóstico dos anúncios (Meta e TikTok): o que o servidor enxerga das
 * chaves e o que cada API responde de fato, sem expor os tokens.
 */
export async function GET() {
  const hoje = new Date().toISOString().slice(0, 10);
  const inicio = `${hoje.slice(0, 7)}-01`;
  const linhas: string[] = [];

  // ——— Meta ———
  const metaToken = env("META_ACCESS_TOKEN");
  const conta = env("META_AD_ACCOUNT_ID") || META_PADRAO;
  linhas.push("META ADS", `Token: ${fim(metaToken)}`, `Conta usada: act_${conta}`);
  if (metaToken) {
    try {
      const { j } = await json(
        `${GRAPH}/me/adaccounts?fields=name,account_id,account_status&limit=50&access_token=${encodeURIComponent(metaToken)}`
      );
      if (j.error) linhas.push(`Contas do token: erro — ${j.error.message}`);
      else {
        const lista = (j.data ?? []) as { name?: string; account_id?: string }[];
        linhas.push(
          `Contas que o token enxerga: ${lista.length}`,
          ...lista.map((c) => `  ${c.account_id} ${c.name ?? ""}${c.account_id === conta ? "   ← a usada" : ""}`)
        );
        if (lista.length && !lista.some((c) => c.account_id === conta))
          linhas.push("  ⚠ a conta usada não está entre as do token");
      }
      const { j: ins } = await json(
        `${GRAPH}/act_${conta}/insights?level=account&fields=spend` +
          `&time_range=${encodeURIComponent(JSON.stringify({ since: inicio, until: hoje }))}` +
          `&access_token=${encodeURIComponent(metaToken)}`
      );
      linhas.push(
        ins.error
          ? `Gasto ${inicio} a ${hoje}: erro — ${ins.error.message}`
          : `Gasto ${inicio} a ${hoje}: R$ ${ins.data?.[0]?.spend ?? "0"}`
      );
    } catch (e) {
      linhas.push(`Falhou: ${e instanceof Error ? e.message : "erro"}`);
    }
  }

  // ——— TikTok ———
  const ttToken = env("TIKTOK_ADS_ACCESS_TOKEN");
  const anunciante = env("TIKTOK_ADS_ADVERTISER_ID");
  linhas.push("", "TIKTOK ADS", `Token: ${fim(ttToken)}`, `Advertiser ID: ${anunciante || "AUSENTE"}`);
  if (ttToken && anunciante) {
    try {
      const url = new URL(`${TT_API}/report/integrated/get/`);
      url.searchParams.set("advertiser_id", anunciante);
      url.searchParams.set("report_type", "BASIC");
      url.searchParams.set("data_level", "AUCTION_ADVERTISER");
      url.searchParams.set("dimensions", JSON.stringify(["stat_time_day"]));
      url.searchParams.set("metrics", JSON.stringify(["spend"]));
      url.searchParams.set("start_date", inicio);
      url.searchParams.set("end_date", hoje);
      url.searchParams.set("page_size", "50");
      const { status, j } = await json(url.toString(), { headers: { "Access-Token": ttToken } });
      const dias = (j.data?.list ?? []) as { metrics?: { spend?: string } }[];
      const total = dias.reduce((s, l) => s + parseFloat(l.metrics?.spend ?? "0"), 0);
      linhas.push(
        `Relatório ${inicio} a ${hoje}: HTTP ${status}, code=${j.code} ${j.message ?? ""}`,
        `  ${dias.length} dias, gasto total R$ ${total.toFixed(2)}`
      );
      if (j.code !== 0) linhas.push(`  resposta: ${JSON.stringify(j).slice(0, 400)}`);
    } catch (e) {
      linhas.push(`Falhou: ${e instanceof Error ? e.message : "erro"}`);
    }
  }

  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>Diagnóstico anúncios</title><style>
body{font-family:system-ui,sans-serif;background:#f9f9f7;color:#0b0b0b;padding:24px 14px;max-width:700px;margin:0 auto}
h1{font-size:17px;margin:0 0 12px}
pre{background:#f0efec;border:1px solid #e1e0d9;border-radius:8px;padding:12px;font-size:12px;white-space:pre-wrap;word-break:break-word}
</style></head><body><h1>Diagnóstico dos anúncios</h1>
<pre>${linhas.join("\n").replace(/</g, "&lt;")}</pre></body></html>`;
  return new NextResponse(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}
