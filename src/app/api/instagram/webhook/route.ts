import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { alterarBaseIg, lerBaseIg, type Origem } from "@/lib/instagram/base";
import { processarComentario } from "@/lib/instagram/robo";

export const dynamic = "force-dynamic";

/** Verificação da Meta ao cadastrar o webhook (GET com hub.challenge). */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const { config } = await lerBaseIg();
  if (q.get("hub.mode") === "subscribe" && config.verifyToken && q.get("hub.verify_token") === config.verifyToken) {
    return new NextResponse(q.get("hub.challenge") ?? "", { status: 200 });
  }
  return NextResponse.json({ erro: "token de verificação não confere" }, { status: 403 });
}

interface Valor {
  id?: string;
  comment_id?: string;
  text?: string;
  from?: { id?: string; username?: string };
  media?: { id?: string; media_product_type?: string };
}

/**
 * Comentários (comments) e comentários de live (live_comments) da conta.
 * Responde 200 rápido: a Meta reenvia e acaba desligando webhook lento.
 */
export async function POST(req: NextRequest) {
  const bruto = await req.text();
  const { config } = await lerBaseIg();
  if (config.appSecret) {
    const assinatura = req.headers.get("x-hub-signature-256") ?? "";
    const certo = `sha256=${createHmac("sha256", config.appSecret).update(bruto).digest("hex")}`;
    if (assinatura.length !== certo.length || !timingSafeEqual(Buffer.from(assinatura), Buffer.from(certo))) {
      return NextResponse.json({ erro: "Assinatura inválida" }, { status: 401 });
    }
  }
  let corpo: { entry?: { changes?: { field?: string; value?: Valor }[] }[] } = {};
  try {
    corpo = JSON.parse(bruto);
  } catch {
    return NextResponse.json({ erro: "JSON inválido" }, { status: 400 });
  }

  const comentarios: Parameters<typeof processarComentario>[0][] = [];
  const resumo: { campo: string; resumo: string }[] = [];
  for (const e of corpo.entry ?? []) {
    for (const ch of e.changes ?? []) {
      const v = ch.value ?? {};
      resumo.push({ campo: ch.field ?? "?", resumo: `@${v.from?.username ?? "?"}: ${(v.text ?? "").slice(0, 60)}` });
      if (ch.field !== "comments" && ch.field !== "live_comments") continue;
      const tipo = (v.media?.media_product_type ?? "").toUpperCase();
      const origem: Origem = ch.field === "live_comments" ? "live" : tipo === "REELS" ? "reel" : tipo === "AD" ? "anuncio" : "post";
      comentarios.push({
        commentId: v.id ?? v.comment_id ?? "",
        texto: v.text ?? "",
        userId: v.from?.id ?? "",
        usuario: v.from?.username ?? "",
        mediaId: v.media?.id ?? "",
        origem,
        via: "webhook",
      });
    }
  }
  if (resumo.length) {
    void alterarBaseIg((b) => {
      const em = new Date().toISOString();
      for (const r of resumo) b.ultimosEventos.push({ em, ...r });
    }).catch(() => {});
  }
  // Responde já; as DMs saem em seguida
  for (const c of comentarios) void processarComentario(c).catch((err) => console.error("[instagram]", err));
  return NextResponse.json({ ok: true, recebidos: comentarios.length });
}
