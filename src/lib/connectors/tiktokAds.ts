import type { AdsSpendResult } from "./meta";

const API = "https://business-api.tiktok.com/open_api/v1.3";

/** Gasto diário de anúncios do TikTok Ads (Marketing API, relatório por dia). */
export async function fetchTikTokAdsSpend(fromKey: string, toKey: string): Promise<AdsSpendResult> {
  const token = process.env.TIKTOK_ADS_ACCESS_TOKEN;
  const advertiserId = process.env.TIKTOK_ADS_ADVERTISER_ID;
  if (!token || !advertiserId) {
    return { connected: false, daily: [] };
  }

  try {
    const daily: { date: string; spend: number }[] = [];
    for (let page = 1; page <= 5; page++) {
      const url = new URL(`${API}/report/integrated/get/`);
      url.searchParams.set("advertiser_id", advertiserId);
      url.searchParams.set("report_type", "BASIC");
      url.searchParams.set("data_level", "AUCTION_ADVERTISER");
      url.searchParams.set("dimensions", JSON.stringify(["stat_time_day"]));
      url.searchParams.set("metrics", JSON.stringify(["spend"]));
      url.searchParams.set("start_date", fromKey);
      url.searchParams.set("end_date", toKey);
      url.searchParams.set("page", String(page));
      url.searchParams.set("page_size", "200");

      const res = await fetch(url, {
        headers: { "Access-Token": token },
        cache: "no-store",
      });
      const json = await res.json();
      if (json.code !== 0) {
        throw new Error(`TikTok Ads: ${json.message ?? res.status} (code ${json.code})`);
      }
      for (const row of json.data?.list ?? []) {
        daily.push({
          date: String(row.dimensions?.stat_time_day ?? "").slice(0, 10),
          spend: parseFloat(row.metrics?.spend ?? "0"),
        });
      }
      const totalPages = json.data?.page_info?.total_page ?? 1;
      if (page >= totalPages) break;
    }
    return { connected: true, daily };
  } catch (e) {
    return {
      connected: true,
      error: e instanceof Error ? e.message : "Erro desconhecido",
      daily: [],
    };
  }
}
