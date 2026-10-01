import { gravarBlob, lerBlobs } from "./blobCache";
import { nomeAtualDaLoja } from "./connectors/totvs";

export interface AppConfig {
  metaMensal?: number;
  /** Meta mensal por unidade: "Site", "Centro", "Ribeirão Preto"… */
  metas?: Record<string, number>;
}

const PREFIXO = "config/";
const CHAVE = "settings";
let cache: { value: AppConfig; at: number } | null = null;

/** Fora da Vercel grava em disco, então sempre há onde guardar. */
export function blobAvailable(): boolean {
  return true;
}

export async function readConfig(): Promise<AppConfig> {
  if (cache && Date.now() - cache.at < 60000) return cache.value;
  try {
    const bruto = (await lerBlobs<AppConfig>(PREFIXO, [CHAVE])).get(CHAVE);
    if (!bruto) return {};
    // Meta salva antes de uma loja ser renomeada continua valendo
    const value: AppConfig = {
      ...bruto,
      metas: Object.fromEntries(
        Object.entries(bruto.metas ?? {}).map(([unidade, meta]) => [nomeAtualDaLoja(unidade), meta])
      ),
    };
    cache = { value, at: Date.now() };
    return value;
  } catch {
    return {};
  }
}

export async function writeConfig(value: AppConfig): Promise<void> {
  await gravarBlob(PREFIXO, CHAVE, value);
  cache = { value, at: Date.now() };
}
