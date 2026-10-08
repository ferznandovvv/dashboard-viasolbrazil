import { NextRequest, NextResponse } from "next/server";
import { rodandoLocal, salvarCredenciais, situacaoCredenciais } from "@/lib/credenciais";
import { INTEGRACOES, NOMES_PERMITIDOS } from "@/lib/integracoes";

export const dynamic = "force-dynamic";

/** Quais chaves estão preenchidas. Nunca devolve os valores. */
export async function GET() {
  return NextResponse.json({
    local: rodandoLocal(),
    situacao: situacaoCredenciais(Array.from(NOMES_PERMITIDOS)),
    integracoes: INTEGRACOES,
  });
}

/**
 * Salva chaves coladas na tela. Só rodando numa máquina própria: na Vercel as
 * variáveis vivem no painel dela, e o disco da função não persiste.
 */
export async function POST(req: NextRequest) {
  if (!rodandoLocal()) {
    return NextResponse.json(
      { erro: "Na Vercel, as chaves se configuram no painel dela (Settings → Environment Variables)." },
      { status: 400 }
    );
  }
  const corpo = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const aceitas: Record<string, string> = {};
  for (const [nome, valor] of Object.entries(corpo)) {
    if (NOMES_PERMITIDOS.has(nome) && typeof valor === "string" && valor.trim()) aceitas[nome] = valor;
  }
  salvarCredenciais(aceitas);
  return NextResponse.json({
    salvas: Object.keys(aceitas),
    situacao: situacaoCredenciais(Array.from(NOMES_PERMITIDOS)),
  });
}
