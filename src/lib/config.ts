import { list, put } from "@vercel/blob";

export interface AppConfig {
  metaMensal?: number;
}

const PATH = "config/settings.json";
let cache: { value: AppConfig; at: number } | null = null;

export function blobAvailable(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

export async function readConfig(): Promise<AppConfig> {
  if (!blobAvailable()) return {};
  if (cache && Date.now() - cache.at < 60000) return cache.value;
  try {
    const { blobs } = await list({ prefix: PATH, limit: 1 });
    if (blobs.length === 0) return {};
    const res = await fetch(blobs[0].url, { cache: "no-store" });
    const value = (await res.json()) as AppConfig;
    cache = { value, at: Date.now() };
    return value;
  } catch {
    return {};
  }
}

export async function writeConfig(value: AppConfig): Promise<void> {
  await put(PATH, JSON.stringify(value), {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
  });
  cache = { value, at: Date.now() };
}
