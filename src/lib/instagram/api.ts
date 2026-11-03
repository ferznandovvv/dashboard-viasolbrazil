/**
 * Chamadas à API do Instagram (Instagram Login, graph.instagram.com).
 * Permissões: instagram_business_basic, instagram_business_manage_comments,
 * instagram_business_manage_messages.
 */

export const GRAPH_IG = process.env.IG_GRAPH_URL ?? "https://graph.instagram.com/v21.0";

export class ErroIg extends Error {
  constructor(
    msg: string,
    public codigo?: number,
    public sub?: number,
  ) {
    super(msg);
  }
}

async function chamar<T>(caminho: string, token: string, init?: { method?: string; body?: unknown; query?: Record<string, string> }): Promise<T> {
  const q = new URLSearchParams(init?.query ?? {});
  const url = `${GRAPH_IG}${caminho}${q.size ? `?${q}` : ""}`;
  const r = await fetch(url, {
    method: init?.method ?? "GET",
    headers: { Authorization: `Bearer ${token}`, ...(init?.body ? { "Content-Type": "application/json" } : {}) },
    body: init?.body ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  const txt = await r.text();
  let j: Record<string, unknown> = {};
  try {
    j = JSON.parse(txt) as Record<string, unknown>;
  } catch {
    /* abaixo */
  }
  if (!r.ok || j.error) {
    const e = (j.error ?? {}) as { message?: string; code?: number; error_subcode?: number; error_user_msg?: string };
    throw new ErroIg(e.error_user_msg || e.message || `HTTP ${r.status}`, e.code, e.error_subcode);
  }
  return j as T;
}

/** Quem é a conta do token. */
export function quemSou(token: string) {
  return chamar<{ user_id?: string; id: string; username: string }>("/me", token, { query: { fields: "user_id,username" } });
}

/** Renova o token de 60 dias (precisa ter pelo menos 24 h). */
export async function renovarToken(token: string): Promise<{ token: string; expiraEm: string }> {
  const r = await fetch(`https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(token)}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  const j = (await r.json()) as { access_token?: string; expires_in?: number; error?: { message?: string } };
  if (!j.access_token) throw new ErroIg(j.error?.message ?? `HTTP ${r.status}`);
  return { token: j.access_token, expiraEm: new Date(Date.now() + (j.expires_in ?? 5184000) * 1000).toISOString() };
}

/** Liga os avisos (webhook) da conta: comentários, comentários de live e mensagens. */
export function assinarWebhook(token: string) {
  return chamar<{ success?: boolean }>("/me/subscribed_apps", token, {
    method: "POST",
    query: { subscribed_fields: "comments,live_comments,messages" },
  });
}

export function webhookAssinado(token: string) {
  return chamar<{ data?: { subscribed_fields?: string[] }[] }>("/me/subscribed_apps", token);
}

export interface ComentarioApi {
  id: string;
  text?: string;
  timestamp?: string;
  username?: string;
  from?: { id: string; username?: string };
}

/** Live no ar agora, com os comentários (só existe enquanto transmite). */
export async function liveAgora(token: string): Promise<{ id: string; comentarios: ComentarioApi[] } | null> {
  const r = await chamar<{ data?: { id: string; comments?: { data?: ComentarioApi[] } }[] }>("/me/live_media", token, {
    query: { fields: "id,comments.limit(100){id,text,timestamp,username,from}" },
  });
  const m = r.data?.[0];
  return m ? { id: m.id, comentarios: m.comments?.data ?? [] } : null;
}

/** Resposta privada: uma DM só, pra quem comentou (na live, só enquanto ela está no ar). */
export function respostaPrivada(token: string, commentId: string, texto: string) {
  return chamar<{ recipient_id?: string; message_id?: string }>("/me/messages", token, {
    method: "POST",
    body: { recipient: { comment_id: commentId }, message: { text: texto } },
  });
}
