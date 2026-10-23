export interface AdsSpendResult {
  connected: boolean;
  error?: string;
  /** Gasto diário (datas YYYY-MM-DD no fuso da conta de anúncios) */
  daily: { date: string; spend: number }[];
}

import { comCache } from "../cache";
import { env } from "../env";
import "../credenciais"; // chaves salvas em disco, quando roda fora da Vercel

const GRAPH = "https://graph.facebook.com/v21.0";
// Conta "Via Sol Brazil" — pode ser trocada pela env META_AD_ACCOUNT_ID
const DEFAULT_ACCOUNT = "804350203009075";

/** Gasto diário de anúncios da conta Meta (Marketing API insights). */
export async function fetchMetaSpend(fromKey: string, toKey: string): Promise<AdsSpendResult> {
  return comCache(`meta|${fromKey}|${toKey}`, () => buscarMeta(fromKey, toKey), 10 * 60000, true);
}

async function buscarMeta(fromKey: string, toKey: string): Promise<AdsSpendResult> {
  const token = (env("META_ACCESS_TOKEN") || undefined);
  const account = (env("META_AD_ACCOUNT_ID") || undefined) ?? DEFAULT_ACCOUNT;
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

/**
 * Contas de anúncio das lojas físicas: a "CA VIASOL OFICIAL" (Rio, Praia
 * Grande, BH e SP) e a "Via Sol Ribeirão Preto" (Ribeirão e Fiusa). Pode
 * trocar pela env META_CONTAS_LOJAS, separadas por vírgula.
 */
const CONTAS_LOJAS_PADRAO = ["324266283725524", "343471301180450"];
/** Conta inteira de uma loja: campanha sem a loja no nome vai para ela */
const LOJA_DA_CONTA: Record<string, string> = { "343471301180450": "Ribeirão Preto" };

/** A loja da campanha, pelo nome: [RJ], [PG], [BH], [SP], [RP] ou "LOJA NOVA" (Fiusa). */
export function lojaDaCampanha(nome: string, conta: string): string | null {
  const n = nome.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
  if (/\[RJ\]|RIO DE JANEIRO/.test(n)) return "Rio de Janeiro";
  if (/\[PG\]|PRAIA GRANDE/.test(n)) return "Praia Grande";
  if (/\[BH\]|BELO HORIZONTE/.test(n)) return "Belo Horizonte";
  if (/\[SP\]|ITAIM/.test(n)) return "SP — Itaim";
  if (/FIUSA|LOJA NOVA/.test(n)) return "Fiusa";
  if (/\[RP\]|RIBEIRAO/.test(n)) return "Ribeirão Preto";
  return LOJA_DA_CONTA[conta] ?? null;
}

export interface AnunciosLojas {
  connected: boolean;
  error?: string;
  /** Gasto por loja e por dia */
  porLoja: Record<string, { date: string; spend: number }[]>;
  /** Campanhas das contas das lojas sem loja no nome */
  semLoja: number;
}

/** Gasto diário de anúncios de cada loja física, somando as campanhas dela. */
export async function fetchAnunciosLojas(fromKey: string, toKey: string): Promise<AnunciosLojas> {
  return comCache(`meta-lojas|${fromKey}|${toKey}`, () => buscarLojas(fromKey, toKey), 10 * 60000, true);
}

async function buscarLojas(fromKey: string, toKey: string): Promise<AnunciosLojas> {
  const token = env("META_ACCESS_TOKEN") || undefined;
  if (!token) return { connected: false, porLoja: {}, semLoja: 0 };
  const contas = (env("META_CONTAS_LOJAS") || CONTAS_LOJAS_PADRAO.join(",")).split(/[\s,;]+/).map((c) => c.replace(/^act_/, "")).filter(Boolean);
  const porLoja: AnunciosLojas["porLoja"] = {};
  let semLoja = 0;
  const erros: string[] = [];
  await Promise.all(
    contas.map(async (conta) => {
      try {
        let url =
          `${GRAPH}/act_${conta}/insights?level=campaign&time_increment=1&fields=campaign_name,spend` +
          `&time_range=${encodeURIComponent(JSON.stringify({ since: fromKey, until: toKey }))}` +
          `&limit=500&access_token=${encodeURIComponent(token)}`;
        for (let page = 0; page < 30 && url; page++) {
          const res = await fetch(url, { cache: "no-store" });
          const json = await res.json();
          if (!res.ok || json.error) throw new Error(json.error?.message ?? `Meta respondeu ${res.status}`);
          for (const row of json.data ?? []) {
            const spend = parseFloat(row.spend ?? "0");
            if (!spend) continue;
            const loja = lojaDaCampanha(row.campaign_name ?? "", conta);
            if (!loja) {
              semLoja += spend;
              continue;
            }
            (porLoja[loja] ??= []).push({ date: row.date_start, spend });
          }
          url = json.paging?.next ?? "";
        }
      } catch (e) {
        erros.push(`conta ${conta}: ${e instanceof Error ? e.message : "erro"}`);
      }
    })
  );
  return { connected: true, error: erros.length ? erros.join("; ") : undefined, porLoja, semLoja };
}
