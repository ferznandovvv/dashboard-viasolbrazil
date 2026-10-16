import { NextRequest, NextResponse } from "next/server";
import { lerBase } from "@/lib/crm/base";
import { resumoAtendimento } from "@/lib/crm/atendimento";

export const dynamic = "force-dynamic";

/** Atendimento das lojas no WhatsApp: tempos de resposta e quem está esperando. */
export async function GET(req: NextRequest) {
  const dias = Math.min(90, Math.max(1, Number(req.nextUrl.searchParams.get("dias")) || 7));
  const base = await lerBase();
  return NextResponse.json({ ...resumoAtendimento(base, dias), gatewayUrl: base.config.provedor === "waakg" ? base.config.waakgUrl : undefined, eventos: base.atendimento.length });
}
