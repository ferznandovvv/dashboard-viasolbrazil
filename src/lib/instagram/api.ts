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

/**
 * Por onde falar com a Meta, descoberto ao conectar (o token do login
 * unificado começa com EAA mas pode funcionar só no graph.instagram.com):
 *  - "ig": graph.instagram.com, caminho /me
 *  - "fb": graph.facebook.com, caminho /<id da conta do Instagram>
 */
export type ModoApi = "ig" | "fb";
let modo: ModoApi | undefined;
let contaIg = "";
export const usarConta = (igUserId: string, m?: ModoApi) => {
  contaIg = igUserId;
  if (m) modo = m;
};
const modoDe = (token: string): ModoApi => modo ?? (tokenFacebook(token) ? "fb" : "ig");
const host = (token: string) => (modoDe(token) === "fb" ? GRAPH_FB : GRAPH_IG);
const eu = (token: string) => (modoDe(token) === "fb" && contaIg ? `/${contaIg}` : "/me");

export class ErroIg extends Error {
  constructor(
    msg: string,
    public codigo?: number,
    public sub?: number,
  ) {
    super(msg);
  }
}

async function chamar<T>(caminho: string, token: string, init?: { method?: string; body?: unknown; query?: Record<string, string>; base?: string }): Promise<T> {
  const q = new URLSearchParams(init?.query ?? {});
  const url = `${init?.base ?? host(token)}${caminho}${q.size ? `?${q}` : ""}`;
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

/**
 * Quem é a conta do token, e por onde a API responde. Tenta os três caminhos
 * e, se nenhum der, devolve o erro de cada um (ajuda a ver o que falta no app).
 */
export async function quemSou(token: string): Promise<{ id: string; username: string; pageId?: string; pageToken?: string; modo: ModoApi }> {
  const erros: string[] = [];
  const msg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 160);
  // 1) Login do Instagram (inclusive token EAA do login unificado)
  try {
    const r = await chamar<{ user_id?: string; id: string; username: string }>("/me", token, { base: GRAPH_IG, query: { fields: "user_id,username" } });
    if (r.username) return { id: r.user_id ?? r.id, username: r.username, modo: "ig" };
  } catch (e) {
    erros.push(`instagram /me: ${msg(e)}`);
  }
  // 2) Login do Facebook: conta do Instagram ligada às páginas
  try {
    const r = await chamar<{ data?: { id: string; access_token?: string; instagram_business_account?: { id: string; username?: string } }[] }>("/me/accounts", token, {
      base: GRAPH_FB,
      query: { fields: "access_token,instagram_business_account{id,username}", limit: "100" },
    });
    const contas = (r.data ?? []).filter((p) => p.instagram_business_account);
    const p = contas.find((x) => x.instagram_business_account?.username === "viasolbrazil") ?? contas[0];
    if (p?.instagram_business_account)
      return { id: p.instagram_business_account.id, username: p.instagram_business_account.username ?? "", pageId: p.id, pageToken: p.access_token, modo: "fb" };
    erros.push(`facebook /me/accounts: ${r.data?.length ?? 0} páginas, nenhuma com Instagram`);
  } catch (e) {
    erros.push(`facebook /me/accounts: ${msg(e)}`);
  }
  // 3) Direto na @viasolbrazil
  try {
    const ig = await chamar<{ id: string; username: string }>(`/${IG_VIASOL}`, token, { base: GRAPH_FB, query: { fields: "id,username" } });
    return { id: ig.id, username: ig.username, modo: "fb" };
  } catch (e) {
    erros.push(`facebook /${IG_VIASOL}: ${msg(e)}`);
  }
  throw new ErroIg(erros.join(" | "));
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
  // Login do Facebook: quem manda é a página (token da página, /me = a página)
  return chamar<{ recipient_id?: string; message_id?: string }>(`${modoDe(token) === "fb" ? "/me" : eu(token)}/messages`, token, {
    method: "POST",
    body: { recipient: { comment_id: commentId }, message: { text: texto } },
  });
}

/**
 * Raio-X do token pela própria Meta (debug_token, com o token do app = id|segredo):
 * tipo, permissões e em quais contas/páginas cada permissão vale. Nunca devolve o token.
 */
export async function raioXToken(token: string, appSecret: string, appId = process.env.IG_APP_ID ?? "1065079759887540"): Promise<string> {
  try {
    const u = `${GRAPH_FB}/debug_token?input_token=${encodeURIComponent(token)}&access_token=${encodeURIComponent(`${appId}|${appSecret}`)}`;
    const r = await fetch(u, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
    const j = (await r.json()) as {
      data?: { type?: string; app_id?: string; is_valid?: boolean; user_id?: string; profile_id?: string; expires_at?: number; scopes?: string[]; granular_scopes?: { scope: string; target_ids?: string[] }[]; error?: { message?: string } };
      error?: { message?: string };
    };
    if (j.error) return `raio-x falhou: ${j.error.message}`;
    const d = j.data ?? {};
    const gran = (d.granular_scopes ?? []).map((g) => `${g.scope}${g.target_ids?.length ? `→${g.target_ids.join("/")}` : ""}`).join(", ");
    return `tipo ${d.type}, app ${d.app_id}, válido ${d.is_valid}, user ${d.user_id ?? "-"}, profile ${d.profile_id ?? "-"}, expira ${d.expires_at ? new Date(d.expires_at * 1000).toISOString().slice(0, 10) : "nunca"}, escopos: ${gran || (d.scopes ?? []).join(", ")}${d.error ? `, erro: ${d.error.message}` : ""}`;
  } catch (e) {
    return `raio-x falhou: ${e instanceof Error ? e.message : String(e)}`;
  }
}

/**
 * Token de usuário do Facebook (o do Explorador da Graph API dura 1-2 h):
 * troca pelo de 60 dias. O token da página tirado dele não expira.
 */
export async function tokenLongo(token: string, appSecret: string, appId = process.env.IG_APP_ID ?? "1065079759887540"): Promise<string> {
  const u = `${GRAPH_FB}/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${encodeURIComponent(appSecret)}&fb_exchange_token=${encodeURIComponent(token)}`;
  const r = await fetch(u, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
  const j = (await r.json()) as { access_token?: string; error?: { message?: string } };
  if (!j.access_token) throw new ErroIg(j.error?.message ?? `HTTP ${r.status}`);
  return j.access_token;
}

/** Diagnóstico com o token salvo (nunca devolve o token): o que ele enxerga em cada caminho. */
export async function diagnostico(token: string, igId: string, appSecret: string): Promise<Record<string, unknown>> {
  const tenta = async (nome: string, caminho: string, query: Record<string, string>, base = GRAPH_FB) => {
    try {
      return [nome, await chamar(caminho, token, { base, query })] as const;
    } catch (e) {
      return [nome, `ERRO: ${e instanceof Error ? e.message : String(e)}`] as const;
    }
  };
  const r = await Promise.all([
    tenta("eu", "/me", { fields: "id,name" }),
    tenta("paginas", "/me/accounts", { fields: "id,name,tasks,instagram_business_account{id,username}", limit: "100" }),
    tenta("negocios", "/me/businesses", { fields: "id,name", limit: "20" }),
    tenta("ig", `/${igId}`, { fields: "id,username,name" }),
    tenta("live", `/${igId}/live_media`, { fields: "id" }),
  ]);
  return { ...Object.fromEntries(r), raiox: appSecret ? await raioXToken(token, appSecret) : "sem segredo" };
}
