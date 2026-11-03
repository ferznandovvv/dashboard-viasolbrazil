/**
 * O robô: comentário com a palavra (ex.: QUERO) vira uma DM com o link.
 *
 * Chega por dois caminhos, e os dois caem em processarComentario:
 *  - webhook da Meta (comments e live_comments), o caminho principal;
 *  - vigia da live: enquanto ligada, busca os comentários da live a cada 3 s
 *    (cobre aviso perdido e o caso de a Meta não mandar live_comments).
 *
 * Regras: uma DM por pessoa por live/post; a própria conta nunca dispara;
 * na live, a resposta privada só funciona enquanto ela está no ar.
 */

import { type Origem, type Resposta, alterarBaseIg, lerBaseIg } from "./base";
import { ErroIg, liveAgora, renovarToken, respostaPrivada } from "./api";

export interface Comentario {
  commentId: string;
  texto: string;
  userId: string;
  usuario: string;
  mediaId: string;
  origem: Origem;
  via: Resposta["via"];
}

/** minúsculas, sem acento, sem pontuação/emoji, espaços simples */
export const normalizar = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** A palavra aparece inteira ("quero", "QUERO!!", "eu quero 😍"); "querosene" não. Aceita "queroo". */
export function bate(texto: string, palavras: string[]): boolean {
  const t = ` ${normalizar(texto)} `;
  return palavras.some((p) => {
    const w = normalizar(p);
    if (!w) return false;
    const esticada = w.replace(/(.)$/, "$1+"); // última letra repetida: queroooo
    return new RegExp(`(^| )${esticada}( |$)`).test(t);
  });
}

export function linkCom(link: string, origem: Origem, campanha: string): string {
  try {
    const u = new URL(link);
    u.searchParams.set("utm_source", "instagram");
    u.searchParams.set("utm_medium", origem === "live" ? "live" : "comentario");
    if (campanha) u.searchParams.set("utm_campaign", campanha);
    return u.toString();
  } catch {
    return link;
  }
}

export function montarMensagem(modelo: string, c: Pick<Comentario, "usuario" | "origem">, link: string, campanha: string): string {
  const nome = c.usuario ? `@${c.usuario}` : "";
  return modelo
    .replaceAll("{link}", linkCom(link, c.origem, campanha))
    .replaceAll("{nome}", nome)
    .replace(/Oi, !/g, "Oi!")
    .trim();
}

/** Comentários sendo tratados agora (webhook e vigia podem trazer o mesmo ao mesmo tempo) */
const emAndamento = new Set<string>();

export async function processarComentario(c: Comentario): Promise<string> {
  if (!c.commentId || emAndamento.has(c.commentId)) return "em andamento";
  const base = await lerBaseIg();
  const cfg = base.config;
  if (!cfg.ativo) return "robô desligado";
  if (!cfg.token) return "sem token";
  if (c.userId && c.userId === cfg.igUserId) return "comentário da própria conta";
  if (c.usuario && cfg.usuario && c.usuario.toLowerCase() === cfg.usuario.toLowerCase()) return "comentário da própria conta";
  if (c.origem !== "live" && !cfg.postsTambem) return "posts desligados";
  if (!bate(c.texto, cfg.palavras)) return "sem a palavra";
  // Erro (ex.: Meta fora do ar) pode tentar de novo quando o mesmo comentário voltar
  if (base.respostas.some((r) => r.commentId === c.commentId && r.status !== "erro")) return "já tratado";
  const quem = c.userId || c.usuario;
  if (quem && base.jaRecebeu[c.mediaId]?.includes(quem)) {
    await registrar(c, "repetido", "já recebeu o link nesta live/post");
    return "já recebeu";
  }

  emAndamento.add(c.commentId);
  try {
    const texto = montarMensagem(cfg.mensagem, c, cfg.link, cfg.campanha);
    try {
      await respostaPrivada(cfg.token, c.commentId, texto);
      await registrar(c, "enviado");
      return "enviado";
    } catch (e) {
      const msg = e instanceof ErroIg ? `${e.message}${e.codigo ? ` (código ${e.codigo}${e.sub ? `/${e.sub}` : ""})` : ""}` : String(e);
      await registrar(c, "erro", msg);
      return `erro: ${msg}`;
    }
  } finally {
    emAndamento.delete(c.commentId);
  }
}

function registrar(c: Comentario, status: Resposta["status"], detalhe?: string) {
  return alterarBaseIg((b) => {
    if (b.respostas.some((r) => r.commentId === c.commentId && r.status !== "erro")) return;
    b.respostas = b.respostas.filter((r) => r.commentId !== c.commentId);
    b.respostas.push({
      commentId: c.commentId,
      em: new Date().toISOString(),
      usuario: c.usuario,
      userId: c.userId,
      texto: c.texto.slice(0, 200),
      origem: c.origem,
      mediaId: c.mediaId,
      status,
      detalhe,
      via: c.via,
    });
    const quem = c.userId || c.usuario;
    if (status === "enviado" && quem) (b.jaRecebeu[c.mediaId] ??= []).push(quem);
  });
}

/* ———————— Vigia da live ———————— */

const vigia = globalThis as unknown as { __igVigia?: { ligada: boolean; ultimoErro?: string; liveId?: string; vistos: Set<string>; ultimaBusca?: string } };
const estado = (vigia.__igVigia ??= { ligada: false, vistos: new Set() });

export const estadoVigia = () => ({ ultimoErro: estado.ultimoErro, liveId: estado.liveId, ultimaBusca: estado.ultimaBusca });

let rodandoVigia = false;

/** Um passo da vigia (o agendador chama a cada 3 s). */
export async function passoVigia(): Promise<void> {
  if (rodandoVigia) return;
  rodandoVigia = true;
  try {
    const { config: cfg } = await lerBaseIg();
    if (!cfg.ativo || !cfg.token || !cfg.vigiaAte || Date.parse(cfg.vigiaAte) < Date.now()) {
      estado.liveId = undefined;
      return;
    }
    const live = await liveAgora(cfg.token);
    estado.ultimaBusca = new Date().toISOString();
    estado.ultimoErro = undefined;
    if (!live) {
      estado.liveId = undefined;
      return;
    }
    if (estado.liveId !== live.id) estado.vistos.clear();
    estado.liveId = live.id;
    for (const k of live.comentarios) {
      if (estado.vistos.has(k.id)) continue;
      estado.vistos.add(k.id);
      await processarComentario({
        commentId: k.id,
        texto: k.text ?? "",
        userId: k.from?.id ?? "",
        usuario: k.from?.username ?? k.username ?? "",
        mediaId: live.id,
        origem: "live",
        via: "vigia",
      });
    }
  } catch (e) {
    estado.ultimoErro = e instanceof Error ? e.message : String(e);
  } finally {
    rodandoVigia = false;
  }
}

/** Token de 60 dias: renova quando faltar menos de 15 (o agendador chama 1x por dia). */
export async function renovarSePreciso(): Promise<string> {
  const { config: cfg } = await lerBaseIg();
  if (!cfg.token) return "sem token";
  const expira = cfg.tokenExpiraEm ? Date.parse(cfg.tokenExpiraEm) : 0;
  if (expira && expira - Date.now() > 15 * 86400_000) return "em dia";
  const r = await renovarToken(cfg.token);
  await alterarBaseIg((b) => {
    b.config.token = r.token;
    b.config.tokenExpiraEm = r.expiraEm;
  });
  return "renovado";
}
