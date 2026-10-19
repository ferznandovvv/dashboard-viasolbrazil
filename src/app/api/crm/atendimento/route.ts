import { NextRequest, NextResponse } from "next/server";
import { alterarBase, lerBase } from "@/lib/crm/base";
import { resumoAtendimento } from "@/lib/crm/atendimento";
import { linkDaWaakg } from "@/lib/crm/tipos";

export const dynamic = "force-dynamic";

/** Atendimento das lojas no WhatsApp: tempos de resposta e quem está esperando. */
export async function GET(req: NextRequest) {
  const dias = Math.min(90, Math.max(1, Number(req.nextUrl.searchParams.get("dias")) || 7));
  const base = await lerBase();
  return NextResponse.json({ ...resumoAtendimento(base, dias), gatewayUrl: linkDaWaakg(base.config), eventos: base.atendimento.length });
}

/** "Não precisa responder": tira a conversa da lista de espera até a cliente escrever de novo. */
export async function POST(req: NextRequest) {
  const p = (await req.json().catch(() => ({}))) as { acao?: string; loja?: string; telefone?: string; ate?: string };
  if (p.acao !== "ignorar" || !p.loja || !p.telefone) return NextResponse.json({ erro: "Pedido inválido" }, { status: 400 });
  const ate = p.ate && !Number.isNaN(Date.parse(p.ate)) ? p.ate : new Date().toISOString();
  await alterarBase((b) => {
    const ig = (b.atendimentoIgnorado ??= {});
    ig[`${p.loja}|${p.telefone}`] = ate;
    // Guarda só os últimos 30 dias
    const corte = new Date(Date.now() - 30 * 86400000).toISOString();
    for (const [k, v] of Object.entries(ig)) if (v < corte) delete ig[k];
  });
  return NextResponse.json({ ok: true });
}
