import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { LOJAS } from "@/lib/connectors/totvs";
import { type Conta, alterarAcesso, contaPublica, hashSenha, lerAcesso, novoIdConta } from "@/lib/acesso/base";
import { abrirSessao, exigirArea, senhaAntigaVale } from "@/lib/acesso/sessao";
import { PAPEIS, type Papel } from "@/lib/acesso/regras";

export const dynamic = "force-dynamic";

/** Pessoas e acessos: a lista, para a tela de Configurações (só o dono). */
export async function GET(req: NextRequest) {
  const s = await exigirArea(req, "config");
  if (s instanceof NextResponse) return s;
  const base = await lerAcesso();
  return NextResponse.json({
    contas: base.contas.map(contaPublica),
    lojas: Object.values(LOJAS),
    senhaAntiga: senhaAntigaVale(base),
    temSenhaAntiga: Boolean(env("DASHBOARD_PASSWORD")),
    eu: s.id,
  });
}

interface Dados {
  nome?: string;
  login?: string;
  senha?: string;
  papel?: Papel;
  lojas?: string[];
  podeLancar?: boolean;
  veDre?: boolean;
  ativo?: boolean;
}
type Pedido =
  | ({ acao: "criar" } & Dados)
  | ({ acao: "editar"; id: string } & Dados)
  | { acao: "senha"; id: string; senha: string }
  | { acao: "senha-antiga"; ligada: boolean };

const LOGIN_OK = /^[a-z0-9._-]{2,30}$/;

/** Confere e arruma o que veio da tela; erro em texto para mostrar a quem cadastrou. */
function validar(d: Dados, base: { contas: Conta[] }, id?: string) {
  const nome = (d.nome ?? "").trim();
  const login = (d.login ?? "").trim().toLowerCase();
  const papel = d.papel ?? "socia";
  if (!nome) throw new Error("Preencha o nome.");
  if (!LOGIN_OK.test(login)) throw new Error("O usuário precisa ter de 2 a 30 letras minúsculas, números, ponto ou traço, sem espaço.");
  if (base.contas.some((c) => c.login === login && c.id !== id)) throw new Error(`Já existe alguém com o usuário “${login}”.`);
  if (!(papel in PAPEIS)) throw new Error("Escolha o papel.");
  const todas = Object.values(LOJAS);
  const lojas = papel === "loja" ? (d.lojas ?? []).filter((l) => todas.includes(l)) : [];
  if (papel === "loja" && !lojas.length) throw new Error("Escolha a loja desse usuário.");
  return { nome, login, papel, lojas, podeLancar: papel === "socia" ? Boolean(d.podeLancar) : true, veDre: papel === "financeiro" ? Boolean(d.veDre) : true };
}

/** Sempre sobra pelo menos um dono ativo: senão ninguém entra nas Configurações. */
function garantirDono(contas: Conta[]) {
  if (!contas.some((c) => c.ativo && c.papel === "dono")) throw new Error("Precisa ficar pelo menos um Dono ativo.");
}

export async function POST(req: NextRequest) {
  const s = await exigirArea(req, "config");
  if (s instanceof NextResponse) return s;
  const p = (await req.json().catch(() => ({}))) as Pedido;
  try {
    if (p.acao === "senha-antiga") {
      await alterarAcesso((b) => {
        b.senhaAntiga = Boolean(p.ligada);
      });
      return NextResponse.json({ ok: true });
    }
    if (p.acao === "criar") {
      if ((p.senha ?? "").length < 6) throw new Error("A senha precisa ter pelo menos 6 caracteres.");
      const c = await alterarAcesso((b) => {
        const nova: Conta = {
          id: novoIdConta(),
          ...validar(p, b),
          ...hashSenha(p.senha!),
          ativo: true,
          versao: 1,
          criadoEm: new Date().toISOString(),
        };
        b.contas.push(nova);
        return nova;
      });
      return NextResponse.json({ ok: true, conta: contaPublica(c) });
    }
    if (p.acao === "editar") {
      const c = await alterarAcesso((b) => {
        const c = b.contas.find((x) => x.id === p.id);
        if (!c) throw new Error("Pessoa não encontrada.");
        const v = validar(p, b, c.id);
        const ativo = p.ativo ?? c.ativo;
        if (c.ativo && !ativo) c.versao++; // desligou: derruba a sessão aberta
        Object.assign(c, v, { ativo });
        garantirDono(b.contas);
        return c;
      });
      return NextResponse.json({ ok: true, conta: contaPublica(c) });
    }
    if (p.acao === "senha") {
      if ((p.senha ?? "").length < 6) throw new Error("A senha precisa ter pelo menos 6 caracteres.");
      const c = await alterarAcesso((b) => {
        const c = b.contas.find((x) => x.id === p.id);
        if (!c) throw new Error("Pessoa não encontrada.");
        Object.assign(c, hashSenha(p.senha), { versao: c.versao + 1 });
        return c;
      });
      const res = NextResponse.json({ ok: true });
      // Trocou a própria senha: continua dentro, com a sessão nova
      if (c.id === s.id) await abrirSessao(res, req, c);
      return res;
    }
    throw new Error("Pedido não reconhecido.");
  } catch (e) {
    const erro = e instanceof Error ? e.message : "Erro";
    return NextResponse.json({ erro, error: erro }, { status: 400 });
  }
}
