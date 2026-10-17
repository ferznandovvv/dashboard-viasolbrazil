import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { lerBase } from "@/lib/crm/base";
import { type EventoRecebido, receberEvento } from "@/lib/crm/fila";

export const dynamic = "force-dynamic";

/**
 * Recebe os eventos do WhatsApp. A URL leva o segredo (?t=), que é o que
 * autentica; o middleware deixa esta rota passar sem cookie.
 *
 * Aceita o formato da WA-AKG ({ event, sessionId, data }) e o da Cloud API
 * ({ entry[].changes[].value.messages / statuses }).
 */
export async function POST(req: NextRequest) {
  const t = req.nextUrl.searchParams.get("t") ?? "";
  const base = await lerBase();
  const esperado = base.config.webhookSegredo;
  if (!t || t.length !== esperado.length || !timingSafeEqual(Buffer.from(t), Buffer.from(esperado))) {
    return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  }
  const corpo = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!corpo) return NextResponse.json({ erro: "JSON inválido" }, { status: 400 });

  const eventos = extrair(corpo);
  const feitos: string[] = [];
  for (const ev of eventos) feitos.push(await receberEvento(ev));
  return NextResponse.json({ ok: true, feitos });
}

/** Verificação da Cloud API (GET com hub.challenge). */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const base = await lerBase();
  if (q.get("hub.mode") === "subscribe" && q.get("hub.verify_token") === base.config.webhookSegredo) {
    return new NextResponse(q.get("hub.challenge") ?? "", { status: 200 });
  }
  return NextResponse.json({ ok: true });
}

/**
 * Hora em que a mensagem foi mandada (não a que chegou aqui): se o
 * computador ficou desligado, as mensagens da noite chegam todas de manhã
 * e não podem parecer que a loja respondeu na hora.
 */
function quando(ts: unknown): string | undefined {
  const n = typeof ts === "object" && ts !== null && "low" in ts ? Number((ts as { low: number }).low) : Number(ts);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  const ms = n > 1e12 ? n : n * 1000;
  const agora = Date.now();
  if (ms > agora + 5 * 60000 || ms < agora - 3 * 86400000) return undefined;
  return new Date(ms).toISOString();
}

const telefoneDoJid = (jid: unknown) => String(jid ?? "").split("@")[0].split(":")[0].replace(/\D/g, "");

function extrair(c: Record<string, unknown>): EventoRecebido[] {
  const out: EventoRecebido[] = [];

  // WA-AKG
  if (typeof c.event === "string" && c.data && typeof c.data === "object") {
    const d = c.data as Record<string, unknown>;
    const sessao = String(c.sessionId ?? "");
    if (c.event === "message.received" || c.event === "message.sent") {
      const key = (d.key ?? {}) as Record<string, unknown>;
      if (d.isGroup || String(d.chatType ?? "PERSONAL") !== "PERSONAL") return out;
      const fromMe = c.event === "message.sent" || Boolean(key.fromMe);
      // remoteJid é sempre a conversa (a cliente), mesmo quando a loja mandou pelo celular;
      // no evento message.sent (API) a outra parte vem em receiver
      const tel = telefoneDoJid(c.event === "message.sent" ? (d.receiver ?? key.remoteJid) : (key.remoteJid ?? d.from));
      if (!tel || tel.length < 10) return out;
      out.push({
        em: quando(d.messageTimestamp),
        // Nome que a cliente usa no WhatsApp (só quando é ela que escreve)
        nome: !fromMe && typeof d.pushName === "string" && d.pushName.trim() ? d.pushName.trim().slice(0, 60) : undefined,
        tipo: "mensagem",
        sessao,
        telefone: tel,
        fromMe,
        texto: typeof d.content === "string" ? d.content : typeof d.caption === "string" ? d.caption : `[${String(d.type ?? "mídia").toLowerCase()}]`,
        idExterno: typeof key.id === "string" ? key.id : undefined,
      });
    } else if (c.event === "message.status") {
      out.push({ tipo: "status", sessao, telefone: telefoneDoJid(d.remoteJid), idExterno: String(d.keyId ?? d.id ?? ""), status: String(d.status ?? "") });
    }
    return out;
  }

  // Cloud API
  const entries = c.entry as { changes?: { value?: Record<string, unknown> }[] }[] | undefined;
  for (const e of entries ?? []) {
    for (const ch of e.changes ?? []) {
      const v = ch.value ?? {};
      const sessao = String(((v.metadata ?? {}) as Record<string, unknown>).phone_number_id ?? "");
      for (const m of (v.messages ?? []) as Record<string, unknown>[]) {
        const texto = ((m.text ?? {}) as { body?: string }).body ?? `[${String(m.type ?? "mídia")}]`;
        out.push({ tipo: "mensagem", sessao, telefone: String(m.from ?? "").replace(/\D/g, ""), texto, idExterno: String(m.id ?? ""), em: quando(m.timestamp) });
      }
      for (const s of (v.statuses ?? []) as Record<string, unknown>[]) {
        out.push({ tipo: "status", sessao, telefone: String(s.recipient_id ?? ""), idExterno: String(s.id ?? ""), status: String(s.status ?? "").toUpperCase() });
      }
    }
  }
  return out;
}
