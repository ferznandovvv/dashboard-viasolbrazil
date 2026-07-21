import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { fetchShopifyOrders } from "@/lib/connectors/shopify";
import { fetchMeliOrders } from "@/lib/connectors/mercadolivre";
import { fetchTikTokOrders } from "@/lib/connectors/tiktok";
import { addDays, spDateKey, spMidnight, todaySpKey } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Snapshot diário do dia anterior, gravado no Vercel Blob (histórico
 * permanente, além da janela que as APIs dos canais permitem consultar).
 * Chamado pelo cron da Vercel; roda também manualmente via GET.
 */
export async function GET(req: NextRequest) {
  // Se CRON_SECRET estiver definido, exige o header que o cron da Vercel envia
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json({
      skipped: true,
      reason:
        "Histórico desativado: crie um Blob Store na Vercel (Storage → Create → Blob) para ativar.",
    });
  }

  const yesterday = addDays(todaySpKey(), -1);
  const since = spMidnight(yesterday);

  const results = await Promise.all([
    fetchShopifyOrders(since),
    fetchTikTokOrders(since),
    fetchMeliOrders(since),
  ]);

  const snapshot: Record<string, unknown> = { date: yesterday };
  for (const r of results) {
    const dayOrders = r.orders.filter((o) => spDateKey(o.createdAt) === yesterday);
    snapshot[r.channel] = {
      connected: r.connected,
      revenue: dayOrders.reduce((s, o) => s + o.total, 0),
      orders: dayOrders.length,
    };
  }

  const blob = await put(`snapshots/${yesterday}.json`, JSON.stringify(snapshot), {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
  });

  return NextResponse.json({ saved: true, url: blob.url, snapshot });
}
