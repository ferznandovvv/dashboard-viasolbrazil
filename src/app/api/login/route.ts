import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { alterarAcesso, hashSenha, lerAcesso, novoIdConta, senhaConfere, type Conta } from "@/lib/acesso/base";
import { abrirSessao, fecharSessao, senhaAntigaVale, sistemaAberto } from "@/lib/acesso/sessao";
import { inicio } from "@/lib/acesso/regras";

export const dynamic = "force-dynamic";

const local = () => !env("VERCEL_URL");

// Tentativas erradas por endereço, para ninguém ficar chutando senha
const g = globalThis as unknown as { __tentativas?: Map<string, { n: number; desde: number }> };
const JANELA_MS = 10 * 60000;
const MAX_ERROS = 10;
const ip = (req: NextRequest) => req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "local";
function bloqueado(req: NextRequest): boolean {
  const t = g.__tentativas?.get(ip(req));
  return Boolean(t && Date.now() - t.desde < JANELA_MS && t.n >= MAX_ERROS);
}
function errou(req: NextRequest) {
  g.__tentativas ??= new Map();
  const t = g.__tentativas.get(ip(req));
  if (!t || Date.now() - t.desde >= JANELA_MS) g.__tentativas.set(ip(req), { n: 1, desde: Date.now() });
  else t.n++;
}

const erro = (texto: string, status: number) => NextResponse.json({ erro: texto, error: texto }, { status });

/** O que a tela de entrar precisa saber: se ainda falta criar o dono e se a senha antiga vale. */
export async function GET() {
  if (!local()) return NextResponse.json({ precisaDono: false, senhaAntiga: Boolean(env("DASHBOARD_PASSWORD")), pedeSenhaPainel: false });
  const base = await lerAcesso();
  return NextResponse.json({
    precisaDono: !base.contas.some((c) => c.ativo),
    senhaAntiga: senhaAntigaVale(base),
    pedeSenhaPainel: Boolean(env("DASHBOARD_PASSWORD")),
    aberto: sistemaAberto(base),
  });
}

interface Pedido {
  acao?: "criar-dono";
  login?: string;
  senha?: string;
  nome?: string;
  senhaPainel?: string;
}

/** Entrar com usuário e senha (ou só a senha antiga do painel); ou criar a primeira conta. */
export async function POST(req: NextRequest) {
  if (bloqueado(req)) return erro("Muitas tentativas erradas. Espere 10 minutos e tente de novo.", 429);
  const p = (await req.json().catch(() => ({}))) as Pedido & { password?: string };
  const senha = p.senha ?? p.password ?? "";
  const login = (p.login ?? "").trim().toLowerCase();

  if (p.acao === "criar-dono") {
    if (!local()) return erro("Contas só existem no sistema da máquina da empresa.", 400);
    const painel = env("DASHBOARD_PASSWORD");
    if (painel && p.senhaPainel !== painel) {
      errou(req);
      return erro("A senha atual do painel não confere.", 401);
    }
    if (!(p.nome ?? "").trim() || !/^[a-z0-9._-]{2,30}$/.test(login)) return erro("Preencha o nome e um usuário só com letras, números ou ponto.", 400);
    if (senha.length < 6) return erro("A senha precisa ter pelo menos 6 caracteres.", 400);
    const conta = await alterarAcesso((b) => {
      if (b.contas.some((c) => c.ativo)) throw new Error("O dono já foi cadastrado. Entre com o usuário dele.");
      const c: Conta = {
        id: novoIdConta(),
        nome: p.nome!.trim(),
        login,
        ...hashSenha(senha),
        papel: "dono",
        lojas: [],
        podeLancar: true,
        veDre: true,
        ativo: true,
        versao: 1,
        criadoEm: new Date().toISOString(),
      };
      b.contas.push(c);
      b.donoJaEntrou = true;
      return c;
    }).catch((e: Error) => e);
    if (conta instanceof Error) return erro(conta.message, 400);
    const res = NextResponse.json({ ok: true, inicio: inicio("dono") });
    await abrirSessao(res, req, conta);
    return res;
  }

  if (login) {
    const base = local() ? await lerAcesso() : null;
    const c = base?.contas.find((x) => x.ativo && x.login === login);
    if (!c || !senhaConfere(c, senha)) {
      errou(req);
      return erro("Usuário ou senha não conferem.", 401);
    }
    // Primeira vez que um dono entra com o usuário: a senha antiga deixa de ser de dono
    if (c.papel === "dono" && !base?.donoJaEntrou) await alterarAcesso((b) => void (b.donoJaEntrou = true));
    const res = NextResponse.json({ ok: true, inicio: inicio(c.papel) });
    await abrirSessao(res, req, c);
    return res;
  }

  // Sem usuário: a senha única antiga do painel, enquanto valer
  const painel = env("DASHBOARD_PASSWORD");
  const vale = local() ? senhaAntigaVale(await lerAcesso()) : Boolean(painel);
  if (!vale || !painel || senha !== painel) {
    errou(req);
    return erro(vale ? "Senha incorreta." : "Digite seu usuário e sua senha.", 401);
  }
  const res = NextResponse.json({ ok: true, inicio: "/" });
  await abrirSessao(res, req, null);
  return res;
}

/** Sair. */
export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  fecharSessao(res);
  return res;
}
