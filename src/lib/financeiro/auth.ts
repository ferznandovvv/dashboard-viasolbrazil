/**
 * Login do financeiro: cada pessoa com usuário e senha própria, para o
 * sistema saber quem lançou e quem deu baixa. Vale por cima da senha geral
 * do dashboard. Só roda no servidor Node.
 */

import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { lerBase } from "./base";
import type { BaseFinanceira, Usuario, UsuarioPublico } from "./tipos";

export const COOKIE = "vs_fin";
const VALIDADE_MS = 30 * 24 * 60 * 60000; // 30 dias

export function hashSenha(senha: string): { hash: string; salt: string } {
  const salt = randomBytes(16).toString("hex");
  return { salt, hash: scryptSync(senha, salt, 64).toString("hex") };
}

export function senhaConfere(u: Usuario, senha: string): boolean {
  const tentativa = scryptSync(senha, u.salt, 64);
  const certo = Buffer.from(u.hash, "hex");
  return certo.length === tentativa.length && timingSafeEqual(certo, tentativa);
}

const assinar = (texto: string, segredo: string) =>
  createHmac("sha256", segredo).update(texto).digest("base64url");

export function criarSessao(res: NextResponse, req: NextRequest, u: Usuario, base: BaseFinanceira) {
  const exp = Date.now() + VALIDADE_MS;
  const corpo = `${u.id}.${exp}`;
  res.cookies.set(COOKIE, `${corpo}.${assinar(corpo, base.config.segredo)}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: req.headers.get("x-forwarded-proto") === "https" || req.nextUrl.protocol === "https:",
    maxAge: VALIDADE_MS / 1000,
    path: "/",
  });
}

export function encerrarSessao(res: NextResponse) {
  res.cookies.set(COOKIE, "", { maxAge: 0, path: "/" });
}

export function publico(u: Usuario): UsuarioPublico {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { hash, salt, ...resto } = u;
  return resto;
}

/** Quem está logado no financeiro, ou null. */
export async function usuarioAtual(
  req: NextRequest
): Promise<{ usuario: Usuario; base: BaseFinanceira } | null> {
  const valor = req.cookies.get(COOKIE)?.value ?? "";
  const [id, exp, assinatura] = valor.split(".");
  if (!id || !exp || !assinatura || Number(exp) < Date.now()) return null;
  const base = await lerBase();
  const esperado = assinar(`${id}.${exp}`, base.config.segredo);
  if (esperado.length !== assinatura.length || !timingSafeEqual(Buffer.from(esperado), Buffer.from(assinatura)))
    return null;
  const usuario = base.usuarios.find((u) => u.id === id && u.ativo);
  return usuario ? { usuario, base } : null;
}

/**
 * Porteiro das rotas: devolve o usuário ou a resposta de erro pronta.
 * `admin` exige administrador; `dre` exige permissão de ver o DRE.
 */
export async function exigir(
  req: NextRequest,
  opcoes: { admin?: boolean; dre?: boolean } = {}
): Promise<{ usuario: Usuario; base: BaseFinanceira } | NextResponse> {
  const atual = await usuarioAtual(req);
  if (!atual) return NextResponse.json({ erro: "Entre com seu usuário do financeiro." }, { status: 401 });
  const { usuario } = atual;
  if (opcoes.admin && usuario.papel !== "admin")
    return NextResponse.json({ erro: "Só o administrador pode fazer isso." }, { status: 403 });
  if (opcoes.dre && usuario.papel !== "admin" && !usuario.veDre)
    return NextResponse.json({ erro: "Seu usuário não tem acesso ao DRE." }, { status: 403 });
  return atual;
}
