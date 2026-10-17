import { NextRequest, NextResponse } from "next/server";
import { completarTelefones, diagnostico, explorar, progresso, sincronizar } from "@/lib/crm/totvs";
import { hojeSp, somarDias } from "@/lib/crm/base";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Andamento da sincronização em curso. */
export async function GET() {
  return NextResponse.json(progresso);
}

type Pedido =
  | { acao: "sincronizar"; de?: string; ate?: string; creditar?: boolean; pessoasAlteradas?: boolean }
  | { acao: "diag" }
  | { acao: "explorar" }
  | { acao: "telefones" };

/**
 * Dispara a sincronização (roda em segundo plano; a tela acompanha pelo GET)
 * ou devolve a resposta crua da API para conferir os campos.
 */
export async function POST(req: NextRequest) {
  const p = (await req.json().catch(() => ({}))) as Pedido;
  try {
    if (p.acao === "diag") return NextResponse.json(await diagnostico());
    if (p.acao === "explorar") return NextResponse.json(await explorar());
    if (p.acao === "telefones") {
      if (progresso.rodando) return NextResponse.json({ erro: "Já tem uma sincronização rodando." }, { status: 409 });
      void completarTelefones().catch(() => {});
      await new Promise((r) => setTimeout(r, 300));
      return NextResponse.json(progresso);
    }
    if (p.acao === "sincronizar") {
      const hoje = hojeSp();
      const de = p.de ?? somarDias(hoje, -3);
      const ate = p.ate ?? hoje;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(de) || !/^\d{4}-\d{2}-\d{2}$/.test(ate) || de > ate) {
        return NextResponse.json({ erro: "Período inválido." }, { status: 400 });
      }
      if (progresso.rodando) return NextResponse.json({ erro: "Já tem uma sincronização rodando." }, { status: 409 });
      // Não espera terminar: períodos longos levam minutos
      void sincronizar(de, ate, { creditar: p.creditar ?? false, pessoasAlteradas: p.pessoasAlteradas ?? false }).catch(() => {});
      await new Promise((r) => setTimeout(r, 300));
      return NextResponse.json(progresso);
    }
    return NextResponse.json({ erro: "Ação desconhecida." }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ erro: e instanceof Error ? e.message : "Erro" }, { status: 400 });
  }
}
