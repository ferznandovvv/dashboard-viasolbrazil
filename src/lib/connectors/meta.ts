export interface AdsSpendResult {
  connected: boolean;
  error?: string;
  /** Gasto diário (datas YYYY-MM-DD no fuso da conta de anúncios) */
  daily: { date: string; spend: number }[];
}

const GRAPH = "https://graph.facebook.com/v21.0";
// Conta "Via Sol Brazil" — pode ser trocada pela env META_AD_ACCOUNT_ID
const DEFAULT_ACCOUNT = "804350203009075";

/** Gasto diário de anúncios da conta Meta (Marketing API insights). */
export async function fetchMetaSpend(fromKey: string, toKey: string): Promise<AdsSpendResult> {
  const token = process.env.META_ACCESS_TOKEN;
  const account = process.env.META_AD_ACCOUNT_ID ?? DEFAULT_ACCOUNT;
  if (!token) {
    return { connected: false, daily: [] };
  }

  try {
    const daily: { date: string; spend: number }[] = [];
    let url =
      `${GRAPH}/act_${account}/insights?level=account&time_increment=1&fields=spend` +
      `&time_range=${encodeURIComponent(JSON.stringify({ since: fromKey, until: toKey }))}` +
      `&limit=500&access_token=${encodeURIComponent(token)}`;

    for (let page = 0; page < 5 && url; page++) {
      const res = await fetch(url, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok || json.error) {
        throw new Error(json.error?.message ?? `Meta respondeu ${res.status}`);
      }
      for (const row of json.data ?? []) {
        daily.push({ date: row.date_start, spend: parseFloat(row.spend ?? "0") });
      }
      url = json.paging?.next ?? "";
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
