/**
 * Clima diário por cidade (Open-Meteo — histórico + previsão, sem chave).
 * Usado para correlacionar tempo e vendas: moda praia vende com sol e calor.
 */

export interface DiaClima {
  date: string;
  tmax: number;
  tmin: number;
  chuva: number;
  /** Código WMO do tempo predominante */
  codigo: number;
}

/** Coordenadas de cada unidade (lojas físicas + site, ancorado em SP). */
export const COORDENADAS: Record<string, { lat: number; lon: number }> = {
  Centro: { lat: -20.5386, lon: -47.4006 }, // Franca/SP
  "Franca Shopping": { lat: -20.5386, lon: -47.4006 },
  "Loja de Fábrica": { lat: -20.5386, lon: -47.4006 },
  "Rio de Janeiro": { lat: -22.9068, lon: -43.1729 },
  "Ribeirão Preto": { lat: -21.1775, lon: -47.8103 },
  "SP — Itaim": { lat: -23.5859, lon: -46.6796 },
  "Belo Horizonte": { lat: -19.9167, lon: -43.9345 },
  "Praia Grande": { lat: -24.0058, lon: -46.4028 },
  Site: { lat: -23.5505, lon: -46.6333 }, // São Paulo, maior mercado
};

/** Rótulo curto do tempo, a partir do código WMO. */
export function tempoLabel(codigo: number): { nome: string; icone: string } {
  if (codigo === 0) return { nome: "Sol", icone: "☀️" };
  if (codigo <= 2) return { nome: "Parcialmente nublado", icone: "🌤️" };
  if (codigo === 3) return { nome: "Nublado", icone: "☁️" };
  if (codigo <= 48) return { nome: "Neblina", icone: "🌫️" };
  if (codigo <= 67) return { nome: "Chuva", icone: "🌧️" };
  if (codigo <= 77) return { nome: "Neve", icone: "🌨️" };
  if (codigo <= 82) return { nome: "Pancadas", icone: "🌦️" };
  return { nome: "Tempestade", icone: "⛈️" };
}

const cache = new Map<string, { at: number; dias: DiaClima[] }>();

export async function fetchClima(
  unidade: string,
  from: string,
  to: string
): Promise<DiaClima[]> {
  const coord = COORDENADAS[unidade];
  if (!coord) return [];

  const chave = `${unidade}|${from}|${to}`;
  const hit = cache.get(chave);
  if (hit && Date.now() - hit.at < 30 * 60000) return hit.dias;

  const campos =
    "daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum" +
    "&timezone=America%2FSao_Paulo";
  const base = `latitude=${coord.lat}&longitude=${coord.lon}&${campos}`;

  const buscar = async (url: string): Promise<DiaClima[]> => {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return [];
    const json = await res.json();
    const d = json.daily;
    if (!d?.time) return [];
    return d.time.map((date: string, i: number) => ({
      date,
      tmax: Number(d.temperature_2m_max?.[i] ?? 0),
      tmin: Number(d.temperature_2m_min?.[i] ?? 0),
      chuva: Number(d.precipitation_sum?.[i] ?? 0),
      codigo: Number(d.weather_code?.[i] ?? 0),
    }));
  };

  try {
    // A previsão cobre os últimos ~90 dias; para períodos mais antigos,
    // completamos com o arquivo histórico e juntamos por data.
    const mapa = new Map<string, DiaClima>();
    const limite = new Date(Date.now() - 88 * 86400000).toISOString().slice(0, 10);
    if (from < limite) {
      for (const dia of await buscar(
        `https://archive-api.open-meteo.com/v1/archive?${base}&start_date=${from}&end_date=${to}`
      )) {
        mapa.set(dia.date, dia);
      }
    }
    const inicioRecente = from > limite ? from : limite;
    if (inicioRecente <= to) {
      for (const dia of await buscar(
        `https://api.open-meteo.com/v1/forecast?${base}&start_date=${inicioRecente}&end_date=${to}`
      )) {
        mapa.set(dia.date, dia);
      }
    }
    const dias = Array.from(mapa.values()).sort((a, b) => a.date.localeCompare(b.date));
    cache.set(chave, { at: Date.now(), dias });
    return dias;
  } catch {
    return [];
  }
}
