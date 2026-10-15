import { NextRequest, NextResponse } from "next/server";
import { criarSessao, encerrarSessao, publico, senhaConfere, usuarioAtual } from "@/lib/financeiro/auth";
import { lerBase } from "@/lib/financeiro/base";
import { rodandoLocal } from "@/lib/credenciais";

export const dynamic = "force-dynamic";

/** Quem está logado — ou se ainda falta criar o primeiro usuário. */
export async function GET(req: NextRequest) {
  if (!rodandoLocal()) return NextResponse.json({ local: false });
  const base = await lerBase();
  const atual = await usuarioAtual(req);
  return NextResponse.json({
    local: true,
    precisaSetup: base.usuarios.length === 0,
    usuario: atual ? publico(atual.usuario) : null,
  });
}

/** Entrar. */
export async function POST(req: NextRequest) {
  const { login, senha } = (await req.json().catch(() => ({}))) as { login?: string; senha?: string };
  const base = await lerBase();
  const u = base.usuarios.find((x) => x.ativo && x.login === (login ?? "").trim().toLowerCase());
  if (!u || !senha || !senhaConfere(u, senha)) {
    return NextResponse.json({ erro: "Usuário ou senha não conferem." }, { status: 401 });
  }
  const res = NextResponse.json({ usuario: publico(u) });
  criarSessao(res, req, u, base);
  return res;
}

/** Sair. */
export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  encerrarSessao(res);
  return res;
}
