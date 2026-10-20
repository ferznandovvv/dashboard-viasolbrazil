import { NextRequest, NextResponse } from "next/server";
import { sessaoDe } from "@/lib/acesso/sessao";
import { gerarPasse } from "@/lib/acesso/ponteWhats";
import { lerBase } from "@/lib/crm/base";
import { linkDaWaakg } from "@/lib/crm/tipos";

export const dynamic = "force-dynamic";

/**
 * Entrar na WA-AKG pelo link whats.: só o dono. Quem não entrou no painel cai
 * no login dele antes (o porteiro manda para /login e volta para cá).
 */
export async function GET(req: NextRequest) {
  const s = await sessaoDe(req);
  if (!s || s.papel !== "dono") {
    return new NextResponse("<!doctype html><meta charset=utf-8><title>WhatsApp</title><p style='font:16px system-ui;padding:24px'>Só o usuário Dono abre o WhatsApp das lojas.</p>", {
      status: 403,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }
  const base = await lerBase();
  const link = linkDaWaakg(base.config);
  if (!link) return NextResponse.json({ erro: "WA-AKG não configurada no CRM." }, { status: 400 });
  const pedido = req.nextUrl.searchParams.get("volta") ?? "/dashboard";
  // Só caminho dentro da WA-AKG (nada de mandar para outro site)
  const volta = /^\/(?!\/)[^\s]*$/.test(pedido) ? pedido : "/dashboard";
  return NextResponse.redirect(`${link}/__portao/entrar?t=${encodeURIComponent(gerarPasse())}&volta=${encodeURIComponent(volta)}`);
}
