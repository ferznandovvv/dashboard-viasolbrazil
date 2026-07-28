/**
 * TOTVS Moda (Virtual Age) — API de Integração V2.
 * Autenticação por senha (grant_type=password) usando o usuário de API
 * (LOGFC006) + um usuário do sistema (ADMFM026).
 */

const DEFAULT_URL = "https://apitotvsmoda.bhan.com.br";

export interface TotvsSale {
  /** Data da venda (YYYY-MM-DD) */
  date: string;
  branchCode: string;
  branchName?: string;
  total: number;
  sellerCode?: string;
  sellerName?: string;
  items: { title: string; qty: number; revenue: number }[];
}

export interface TotvsResult {
  connected: boolean;
  error?: string;
  sales: TotvsSale[];
}

export function totvsBaseUrl(): string {
  return (process.env.TOTVS_API_URL ?? DEFAULT_URL).replace(/\/$/, "");
}

export function totvsConfigured(): boolean {
  return Boolean(
    process.env.TOTVS_CLIENT_ID &&
      process.env.TOTVS_CLIENT_SECRET &&
      process.env.TOTVS_USERNAME &&
      process.env.TOTVS_PASSWORD
  );
}

let cachedToken: { token: string; expiresAt: number } | null = null;

/** Token de acesso da APIv2, com cache em memória. */
export async function getTotvsToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.token;

  const res = await fetch(`${totvsBaseUrl()}/api/totvsmoda/authorization/v2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "password",
      client_id: process.env.TOTVS_CLIENT_ID!,
      client_secret: process.env.TOTVS_CLIENT_SECRET!,
      username: process.env.TOTVS_USERNAME!,
      password: process.env.TOTVS_PASSWORD!,
    }),
    cache: "no-store",
  });

  const text = await res.text();
  let json: { access_token?: string; expires_in?: number; message?: string; error?: string } = {};
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Resposta inesperada do token (${res.status}): ${text.slice(0, 200)}`);
  }
  if (!res.ok || !json.access_token) {
    throw new Error(
      `Falha na autenticação (${res.status}): ${json.message ?? json.error ?? text.slice(0, 200)}`
    );
  }

  cachedToken = {
    token: json.access_token,
    expiresAt: Date.now() + ((json.expires_in ?? 3600) - 300) * 1000,
  };
  return cachedToken.token;
}

/** Chamada autenticada à APIv2. */
export async function totvsFetch(
  path: string,
  body?: unknown
): Promise<{ status: number; json: Record<string, unknown> | null; text: string }> {
  const token = await getTotvsToken();
  const res = await fetch(`${totvsBaseUrl()}${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    cache: "no-store",
  });
  const text = await res.text();
  let json: Record<string, unknown> | null = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* resposta não-JSON: devolvemos o texto cru para diagnóstico */
  }
  return { status: res.status, json, text };
}
