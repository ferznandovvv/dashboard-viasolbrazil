/**
 * Sessão de quem entrou: um cookie assinado com o id da conta, a validade e a
 * versão da conta. A conta é relida a cada pedido, então mudar o papel ou as
 * lojas de alguém vale na hora; trocar a senha ou desligar derruba a sessão.
 * Só roda no servidor Node (rotas e porteiro).
 */

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { env } from "../env";
import { type BaseAcesso, type Conta, lerAcesso } from "./base";
import { type Area, type Papel, ROTAS_DE_APARELHO, temArea } from "./regras";

export const COOKIE_SESSAO = "vs_sessao";
const VALIDADE_MS = 30 * 24 * 60 * 60000; // 30 dias
/** Sessão da senha antiga do painel (não é uma conta) */
const ANTIGA = "antiga";

export interface Sessao {
  id: string;
  nome: string;
  login: string;
  papel: Papel;
  lojas: string[];
  podeLancar: boolean;
  veDre: boolean;
  /** Entrou com a senha antiga do painel */
  antiga: boolean;
}

const local = () => !env("VERCEL_URL");

/**
 * A base de contas. Fora da máquina da empresa (Vercel) não há arquivo: só a
 * senha do painel entra, e o segredo sai dela.
 */
async function contexto(): Promise<BaseAcesso> {
  if (local()) return lerAcesso();
  const senha = env("DASHBOARD_PASSWORD");
  return { contas: [], senhaAntiga: true, segredo: createHash("sha256").update(`viasol-sessao:${senha}`).digest("hex") };
}

const ativas = (b: BaseAcesso) => b.contas.filter((c) => c.ativo);
export const temDono = (b: BaseAcesso) => ativas(b).some((c) => c.papel === "dono");

/** A senha antiga ainda entra? Só se existir e o dono não tiver desligado. */
export const senhaAntigaVale = (b: BaseAcesso) => b.senhaAntiga && Boolean(env("DASHBOARD_PASSWORD"));

/** Sem senha do painel e sem nenhuma conta: o sistema fica aberto, como sempre foi. */
export const sistemaAberto = (b: BaseAcesso) => !env("DASHBOARD_PASSWORD") && ativas(b).length === 0;

const assinar = (texto: string, segredo: string) => createHmac("sha256", segredo).update(texto).digest("base64url");

function deConta(c: Conta): Sessao {
  return {
    id: c.id,
    nome: c.nome,
    login: c.login,
    papel: c.papel,
    lojas: c.papel === "loja" ? c.lojas : [],
    podeLancar: c.papel === "dono" || c.papel === "financeiro" || c.podeLancar,
    veDre: c.papel === "dono" || c.papel === "socia" || c.veDre,
    antiga: false,
  };
}

/** Quem é o dono de um cookie de sessão, ou null. */
export async function lerSessao(valor: string | undefined): Promise<Sessao | null> {
  const base = await contexto();
  if (sistemaAberto(base))
    return { id: "aberto", nome: "Sem login", login: "", papel: "dono", lojas: [], podeLancar: true, veDre: true, antiga: true };
  const [id, exp, versao, assinatura] = (valor ?? "").split(".");
  if (!id || !exp || !versao || !assinatura || Number(exp) < Date.now()) return null;
  const esperado = assinar(`${id}.${exp}.${versao}`, base.segredo);
  if (esperado.length !== assinatura.length || !timingSafeEqual(Buffer.from(esperado), Buffer.from(assinatura))) return null;

  if (id === ANTIGA) {
    if (!senhaAntigaVale(base)) return null;
    // Até um dono entrar com o próprio usuário, a senha antiga continua sendo a do dono
    const papel: Papel = local() && temDono(base) && base.donoJaEntrou ? "socia" : "dono";
    return { id: ANTIGA, nome: "Senha antiga do painel", login: "", papel, lojas: [], podeLancar: papel === "dono", veDre: true, antiga: true };
  }
  const c = base.contas.find((x) => x.id === id && x.ativo);
  return c && String(c.versao) === versao ? deConta(c) : null;
}

export const sessaoDe = (req: NextRequest) => lerSessao(req.cookies.get(COOKIE_SESSAO)?.value);

const seguro = (req: NextRequest) =>
  req.headers.get("x-forwarded-proto") === "https" || req.nextUrl.protocol === "https:";

/** Grava o cookie de sessão de uma conta (ou da senha antiga, com `conta` nula). */
export async function abrirSessao(res: NextResponse, req: NextRequest, conta: Conta | null) {
  const base = await contexto();
  const exp = Date.now() + VALIDADE_MS;
  const corpo = conta ? `${conta.id}.${exp}.${conta.versao}` : `${ANTIGA}.${exp}.1`;
  res.cookies.set(COOKIE_SESSAO, `${corpo}.${assinar(corpo, base.segredo)}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: seguro(req),
    maxAge: VALIDADE_MS / 1000,
    path: "/",
  });
}

/** Sai: apaga a sessão nova e os cookies do login antigo (painel e financeiro). */
export function fecharSessao(res: NextResponse) {
  for (const nome of [COOKIE_SESSAO, "vs_auth", "vs_fin"]) res.cookies.set(nome, "", { maxAge: 0, path: "/" });
}

const recusa = (erro: string, status: number) => NextResponse.json({ erro, error: erro }, { status });

/** Porteiro das rotas: a sessão de quem pode usar esta parte, ou a resposta de erro pronta. */
export async function exigirArea(req: NextRequest, area: Area): Promise<Sessao | NextResponse> {
  const s = await sessaoDe(req);
  if (!s) return recusa("Entre com seu usuário.", 401);
  if (!temArea(s.papel, area)) return recusa("Seu usuário não tem acesso a esta parte.", 403);
  return s;
}

/** O aparelho da loja abriu com o código da TV no endereço? */
export function codigoDeAparelho(req: NextRequest): boolean {
  const codigo = env("TV_CODE");
  return Boolean(codigo) && ROTAS_DE_APARELHO.includes(req.nextUrl.pathname) && req.nextUrl.searchParams.get("k") === codigo;
}
