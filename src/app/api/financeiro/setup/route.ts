import { NextRequest, NextResponse } from "next/server";
import { criarSessao, hashSenha, publico } from "@/lib/financeiro/auth";
import { alterarBase, novoId } from "@/lib/financeiro/base";
import { rodandoLocal } from "@/lib/credenciais";
import type { Usuario } from "@/lib/financeiro/tipos";

export const dynamic = "force-dynamic";

/** Primeiro acesso: cria o administrador. Depois disso, não faz mais nada. */
export async function POST(req: NextRequest) {
  if (!rodandoLocal()) return NextResponse.json({ erro: "O financeiro roda só na máquina." }, { status: 400 });
  const { nome, login, senha } = (await req.json().catch(() => ({}))) as Record<string, string>;
  if (!nome?.trim() || !login?.trim() || (senha ?? "").length < 6) {
    return NextResponse.json({ erro: "Preencha nome, usuário e uma senha de pelo menos 6 caracteres." }, { status: 400 });
  }
  const r = await alterarBase((base) => {
    if (base.usuarios.length > 0) return null;
    const u: Usuario = {
      id: novoId(),
      nome: nome.trim(),
      login: login.trim().toLowerCase(),
      ...hashSenha(senha),
      papel: "admin",
      veDre: true,
      ativo: true,
      criadoEm: new Date().toISOString(),
    };
    base.usuarios.push(u);
    return { u, base };
  });
  if (!r) return NextResponse.json({ erro: "O administrador já foi criado." }, { status: 409 });
  const res = NextResponse.json({ usuario: publico(r.u) });
  criarSessao(res, req, r.u, r.base);
  return res;
}
