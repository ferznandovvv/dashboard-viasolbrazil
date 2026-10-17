import { NextRequest, NextResponse } from "next/server";
import { detalheCredenciais, rodandoLocal, salvarCredenciais, situacaoCredenciais } from "@/lib/credenciais";
import { INTEGRACOES, NOMES_PERMITIDOS } from "@/lib/integracoes";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

/** Estado do atualizador automático (scripts/painel.mjs), quando ele está em uso. */
async function atualizador(): Promise<{ verificadoEm?: string; atualizadoEm?: string; falhou?: string; mensagem?: string } | null> {
  try {
    const pasta = process.env.DADOS_DIR ?? join(process.cwd(), "dados");
    return JSON.parse(await readFile(join(pasta, "painel-estado.json"), "utf8"));
  } catch {
    return null;
  }
}

export const dynamic = "force-dynamic";

/** Quais chaves estão preenchidas. Nunca devolve os valores. */
export async function GET() {
  return NextResponse.json({
    local: rodandoLocal(),
    situacao: situacaoCredenciais(Array.from(NOMES_PERMITIDOS)),
    detalhe: detalheCredenciais(Array.from(NOMES_PERMITIDOS)),
    integracoes: INTEGRACOES,
    atualizador: await atualizador(),
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
    detalhe: detalheCredenciais(Array.from(NOMES_PERMITIDOS)),
  });
}
