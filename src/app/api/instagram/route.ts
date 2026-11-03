import { NextRequest, NextResponse } from "next/server";
import { alterarBaseIg, lerBaseIg, type ConfigInstagram } from "@/lib/instagram/base";
import { assinarWebhook, quemSou, tokenFacebook, usarConta, webhookAssinado } from "@/lib/instagram/api";
import { estadoVigia, montarMensagem } from "@/lib/instagram/robo";
import { mascarar } from "@/lib/segredo";

export const dynamic = "force-dynamic";

const URL_PUBLICA = process.env.PAINEL_URL ?? "https://painel.viasolbrazil.com.br";

/** Tela do robô do Instagram: configuração, situação e últimas respostas. */
export async function GET() {
  const b = await lerBaseIg();
  const c = b.config;
  let assinado: string[] | null = null;
  let erroConta: string | undefined;
  if (c.token) {
    try {
      usarConta(c.igUserId);
      assinado = (await webhookAssinado(c.token, c.pageId)).data?.[0]?.subscribed_fields ?? [];
    } catch (e) {
      erroConta = e instanceof Error ? e.message : String(e);
    }
  }
  const hoje = new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
  const deHoje = b.respostas.filter((r) => new Date(Date.parse(r.em) - 3 * 3600_000).toISOString().slice(0, 10) === hoje);
  return NextResponse.json({
    config: { ...c, token: mascarar(c.token, false), appSecret: mascarar(c.appSecret, false) },
    conectado: Boolean(c.token),
    assinado,
    erroConta,
    webhookUrl: `${URL_PUBLICA}/api/instagram/webhook`,
    vigia: { ligadaAte: c.vigiaAte && Date.parse(c.vigiaAte) > Date.now() ? c.vigiaAte : null, ...estadoVigia() },
    hoje: {
      enviados: deHoje.filter((r) => r.status === "enviado").length,
      erros: deHoje.filter((r) => r.status === "erro").length,
      repetidos: deHoje.filter((r) => r.status === "repetido").length,
    },
    exemplo: montarMensagem(c.mensagem, { usuario: "cliente", origem: "live" }, c.link, c.campanha),
    respostas: b.respostas.slice(-80).reverse(),
    eventos: b.ultimosEventos.slice(-15).reverse(),
  });
}

type Corpo =
  | { acao: "salvar"; config: Partial<Pick<ConfigInstagram, "ativo" | "palavras" | "postsTambem" | "mensagem" | "link" | "campanha" | "appSecret">> }
  | { acao: "conectar"; token: string }
  | { acao: "assinar" }
  | { acao: "vigia"; horas: number };

export async function POST(req: NextRequest) {
  const corpo = (await req.json().catch(() => null)) as Corpo | null;
  if (!corpo) return NextResponse.json({ erro: "corpo inválido" }, { status: 400 });

  if (corpo.acao === "salvar") {
    const n = corpo.config;
    await alterarBaseIg((b) => {
      const c = b.config;
      if (typeof n.ativo === "boolean") c.ativo = n.ativo;
      if (typeof n.postsTambem === "boolean") c.postsTambem = n.postsTambem;
      if (Array.isArray(n.palavras)) c.palavras = n.palavras.map((p) => String(p).trim()).filter(Boolean).slice(0, 10);
      if (typeof n.mensagem === "string" && n.mensagem.trim()) c.mensagem = n.mensagem.slice(0, 950);
      if (typeof n.link === "string" && /^https:\/\//.test(n.link.trim())) c.link = n.link.trim();
      if (typeof n.campanha === "string") c.campanha = n.campanha.trim().replace(/\s+/g, "_").slice(0, 60);
      // Segredo mascarado volta igual da tela: só troca se veio um valor novo
      if (typeof n.appSecret === "string" && n.appSecret.trim() && !n.appSecret.includes("•")) c.appSecret = n.appSecret.trim();
    });
    return NextResponse.json({ ok: true });
  }

  if (corpo.acao === "conectar") {
    const token = String(corpo.token ?? "").trim();
    if (!token) return NextResponse.json({ erro: "Cole o token" }, { status: 400 });
    try {
      const eu = await quemSou(token);
      await alterarBaseIg((b) => {
        b.config.token = token;
        b.config.igUserId = eu.user_id ?? eu.id;
        b.config.usuario = eu.username;
        b.config.pageId = eu.pageId;
        // Token do Facebook (usuário do sistema) não expira; o do Instagram dura 60 dias e renova sozinho
        b.config.tokenExpiraEm = tokenFacebook(token) ? undefined : new Date(Date.now() + 59 * 86400_000).toISOString();
      });
      let assinatura = "ok";
      try {
        await assinarWebhook(token, eu.pageId);
      } catch (e) {
        assinatura = e instanceof Error ? e.message : String(e);
      }
      return NextResponse.json({ ok: true, usuario: eu.username, assinatura });
    } catch (e) {
      return NextResponse.json({ erro: e instanceof Error ? e.message : String(e) }, { status: 400 });
    }
  }

  if (corpo.acao === "assinar") {
    const { config } = await lerBaseIg();
    if (!config.token) return NextResponse.json({ erro: "Conecte a conta primeiro" }, { status: 400 });
    try {
      await assinarWebhook(config.token, config.pageId);
      return NextResponse.json({ ok: true });
    } catch (e) {
      return NextResponse.json({ erro: e instanceof Error ? e.message : String(e) }, { status: 400 });
    }
  }

  if (corpo.acao === "vigia") {
    const horas = Math.max(0, Math.min(12, Number(corpo.horas) || 0));
    await alterarBaseIg((b) => {
      b.config.vigiaAte = horas ? new Date(Date.now() + horas * 3600_000).toISOString() : undefined;
    });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ erro: "ação desconhecida" }, { status: 400 });
}
