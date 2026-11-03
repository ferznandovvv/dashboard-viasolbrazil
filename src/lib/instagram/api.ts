/**
 * Chamadas à API do Instagram (Instagram Login, graph.instagram.com).
 * Permissões: instagram_business_basic, instagram_business_manage_comments,
 * instagram_business_manage_messages.
 */

export const GRAPH_IG = process.env.IG_GRAPH_URL ?? "https://graph.instagram.com/v21.0";
const GRAPH_FB = "https://graph.facebook.com/v21.0";
/** @viasolbrazil */
const IG_VIASOL = process.env.IG_USER_ID ?? "17841400378201514";

/**
 * O app da Meta pode entregar dois tipos de token: o do Login do Instagram
 * (IGAA…, fala com graph.instagram.com e usa /me) e o do login unificado/
 * Facebook (EAA…, fala com graph.facebook.com e usa o id da conta do Instagram).
 */
export const tokenFacebook = (token: string) => token.startsWith("EAA");
const host = (token: string) => (tokenFacebook(token) ? GRAPH_FB : GRAPH_IG);

/** Conta do Instagram que o robô usa no caminho (/me ou o id, conforme o token) */
let contaIg = "";
export const usarConta = (igUserId: string) => void (contaIg = igUserId);
const eu = (token: string) => (tokenFacebook(token) && contaIg ? `/${contaIg}` : "/me");

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
  const url = `${host(token)}${caminho}${q.size ? `?${q}` : ""}`;
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
export async function quemSou(token: string): Promise<{ user_id?: string; id: string; username: string; pageId?: string }> {
  if (!tokenFacebook(token)) return chamar("/me", token, { query: { fields: "user_id,username" } });
  // Token do Facebook: acha a conta do Instagram ligada às páginas (prefere a @viasolbrazil)
  const r = await chamar<{ data?: { id: string; instagram_business_account?: { id: string; username?: string } }[] }>("/me/accounts", token, {
    query: { fields: "instagram_business_account{id,username}", limit: "100" },
  });
  const contas = (r.data ?? []).filter((p) => p.instagram_business_account);
  const p = contas.find((x) => x.instagram_business_account?.username === "viasolbrazil") ?? contas[0];
  if (!p?.instagram_business_account) {
    // Token de usuário do sistema pode não listar páginas: tenta direto a @viasolbrazil
    const ig = await chamar<{ id: string; username: string }>(`/${IG_VIASOL}`, token, { query: { fields: "id,username" } });
    return { id: ig.id, user_id: ig.id, username: ig.username };
  }
  return { id: p.instagram_business_account.id, user_id: p.instagram_business_account.id, username: p.instagram_business_account.username ?? "", pageId: p.id };
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
export function assinarWebhook(token: string, pageId?: string) {
  // Login do Facebook: os avisos do Instagram vêm pela página ligada à conta
  if (tokenFacebook(token) && pageId)
    return chamar<{ success?: boolean }>(`/${pageId}/subscribed_apps`, token, { method: "POST", query: { subscribed_fields: "feed" } });
  return chamar<{ success?: boolean }>("/me/subscribed_apps", token, {
    method: "POST",
    query: { subscribed_fields: "comments,live_comments,messages" },
  });
}

export function webhookAssinado(token: string, pageId?: string) {
  return chamar<{ data?: { subscribed_fields?: string[] }[] }>(tokenFacebook(token) && pageId ? `/${pageId}/subscribed_apps` : "/me/subscribed_apps", token);
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
  const r = await chamar<{ data?: { id: string; comments?: { data?: ComentarioApi[] } }[] }>(`${eu(token)}/live_media`, token, {
    query: { fields: "id,comments.limit(100){id,text,timestamp,username,from}" },
  });
  const m = r.data?.[0];
  return m ? { id: m.id, comentarios: m.comments?.data ?? [] } : null;
}

/** Resposta privada: uma DM só, pra quem comentou (na live, só enquanto ela está no ar). */
export function respostaPrivada(token: string, commentId: string, texto: string) {
  return chamar<{ recipient_id?: string; message_id?: string }>(`${eu(token)}/messages`, token, {
    method: "POST",
    body: { recipient: { comment_id: commentId }, message: { text: texto } },
  });
}
