import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { LOJAS } from "@/lib/connectors/totvs";
import { rodandoLocal, salvarCredenciais } from "@/lib/credenciais";
import { exigirArea } from "@/lib/acesso/sessao";

export const dynamic = "force-dynamic";

/**
 * TV e telas da loja: os aparelhos abrem sem login, com o código da TV no
 * endereço. Aqui o dono vê os links prontos e pode trocar o código (os
 * links antigos param de abrir).
 */
export async function GET(req: NextRequest) {
  const s = await exigirArea(req, "config");
  if (s instanceof NextResponse) return s;
  return NextResponse.json({ codigo: env("TV_CODE"), lojas: Object.values(LOJAS), podeTrocar: rodandoLocal() });
}

export async function POST(req: NextRequest) {
  const s = await exigirArea(req, "config");
  if (s instanceof NextResponse) return s;
  if (!rodandoLocal()) return NextResponse.json({ erro: "Na Vercel o código se troca nas variáveis de ambiente." }, { status: 400 });
  // Fácil de digitar numa TV: sem letras que se confundem
  const letras = "abcdefghjkmnpqrstuvwxyz23456789";
  const codigo = Array.from(randomBytes(8), (b) => letras[b % letras.length]).join("");
  salvarCredenciais({ TV_CODE: codigo });
  return NextResponse.json({ codigo });
}
