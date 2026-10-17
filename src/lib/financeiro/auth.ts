/**
 * Quem está no financeiro. O login agora é o do sistema (Configurações ›
 * Pessoas e acessos): o dono é o administrador daqui, e a sócia e a equipe
 * entram como equipe. Os usuários antigos do financeiro foram copiados para
 * lá com as mesmas senhas. Só roda no servidor Node.
 */

import { NextRequest, NextResponse } from "next/server";
import { lerBase } from "./base";
import { sessaoDe } from "../acesso/sessao";
import { temArea } from "../acesso/regras";
import type { BaseFinanceira, Usuario, UsuarioPublico } from "./tipos";

/** Cookie do login antigo do financeiro: só é apagado ao sair */
export const COOKIE = "vs_fin";

export function encerrarSessao(res: NextResponse) {
  res.cookies.set(COOKIE, "", { maxAge: 0, path: "/" });
}

export function publico(u: Usuario): UsuarioPublico {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { hash, salt, ...resto } = u;
  return resto;
}

/** Quem está logado no sistema e pode usar o financeiro, ou null. */
export async function usuarioAtual(
  req: NextRequest
): Promise<{ usuario: Usuario; base: BaseFinanceira } | null> {
  const s = await sessaoDe(req);
  if (!s || !temArea(s.papel, "financeiro")) return null;
  const base = await lerBase();
  const usuario: Usuario = {
    id: s.id,
    nome: s.nome,
    login: s.login,
    hash: "",
    salt: "",
    papel: s.papel === "dono" ? "admin" : "equipe",
    veDre: s.veDre,
    ativo: true,
    criadoEm: "",
    somenteVer: !s.podeLancar,
  };
  return { usuario, base };
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
  if (usuario.somenteVer && req.method !== "GET")
    return NextResponse.json({ erro: "Seu usuário só pode consultar o financeiro." }, { status: 403 });
  if (opcoes.admin && usuario.papel !== "admin")
    return NextResponse.json({ erro: "Só o administrador pode fazer isso." }, { status: 403 });
  if (opcoes.dre && usuario.papel !== "admin" && !usuario.veDre)
    return NextResponse.json({ erro: "Seu usuário não tem acesso ao DRE." }, { status: 403 });
  return atual;
}
