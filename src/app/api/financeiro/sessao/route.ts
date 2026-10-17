import { NextRequest, NextResponse } from "next/server";
import { encerrarSessao, publico, usuarioAtual } from "@/lib/financeiro/auth";
import { rodandoLocal } from "@/lib/credenciais";

export const dynamic = "force-dynamic";

/** Quem está logado (o login é o do sistema). */
export async function GET(req: NextRequest) {
  if (!rodandoLocal()) return NextResponse.json({ local: false });
  const atual = await usuarioAtual(req);
  return NextResponse.json({ local: true, usuario: atual ? publico(atual.usuario) : null });
}

/** O financeiro não tem mais login próprio. */
export async function POST() {
  return NextResponse.json({ erro: "Entre pela tela de entrada do painel, com seu usuário." }, { status: 410 });
}

/** Sair. */
export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  encerrarSessao(res);
  return res;
}
