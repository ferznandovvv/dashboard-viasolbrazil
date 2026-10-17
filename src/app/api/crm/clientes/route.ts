import { NextRequest, NextResponse } from "next/server";
import { alterarBase, hojeSp, lerBase } from "@/lib/crm/base";
import { type Segmento, SEGMENTOS, noSegmento, resumir, resumirTodos, salvarCliente } from "@/lib/crm/clientes";
import type { ClienteResumo, FaixaCliente } from "@/lib/crm/tipos";
import { normalizarTelefone } from "@/lib/crm/telefone";

export const dynamic = "force-dynamic";

type Ordem = "gasto" | "recente" | "parada" | "nome" | "saldo" | "compras";

/**
 * Lista de clientes com filtros (situação, loja, faixa, busca) e ordem.
 * Devolve também quantas há em cada faixa e em cada loja com os outros
 * filtros aplicados, pra tela mostrar os números nos botões.
 */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const seg = (q.get("segmento") ?? "todos") as Segmento;
  if (!SEGMENTOS.some((s) => s.id === seg)) return NextResponse.json({ erro: "Segmento inválido" }, { status: 400 });
  const loja = q.get("loja") || undefined;
  const faixa = (q.get("faixa") || undefined) as FaixaCliente | undefined;
  const busca = (q.get("busca") ?? "").trim().toLowerCase();
  const ordem = (q.get("ordem") ?? "gasto") as Ordem;
  const limite = Math.min(2000, Math.max(20, Number(q.get("limite")) || 100));
  const base = await lerBase();
  const hoje = hojeSp();

  const lojaDe = (c: ClienteResumo) => c.ultimaLoja ?? c.lojaOrigem ?? "";
  const dig = busca.replace(/\D/g, "");
  const semAcento = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const termo = semAcento(busca);
  let lista = resumirTodos(base, hoje).filter((c) => noSegmento(base, c, seg, hoje));
  if (busca) lista = lista.filter((c) => semAcento(c.nome).includes(termo) || (dig.length >= 4 && (c.telefone?.includes(dig) || c.cpf?.includes(dig))));

  const faixas: Record<string, number> = {};
  const lojas: Record<string, number> = {};
  for (const c of lista) {
    if (!loja || lojaDe(c) === loja) faixas[c.faixa ?? "Sem compra"] = (faixas[c.faixa ?? "Sem compra"] ?? 0) + 1;
    if (!faixa || c.faixa === faixa) lojas[lojaDe(c)] = (lojas[lojaDe(c)] ?? 0) + 1;
  }
  if (loja) lista = lista.filter((c) => lojaDe(c) === loja);
  if (faixa) lista = lista.filter((c) => c.faixa === faixa);

  const cmp: Record<Ordem, (a: ClienteResumo, b: ClienteResumo) => number> = {
    gasto: (a, b) => b.totalGasto - a.totalGasto,
    recente: (a, b) => (b.ultimaCompra ?? "").localeCompare(a.ultimaCompra ?? ""),
    parada: (a, b) => (a.ultimaCompra ?? "9999").localeCompare(b.ultimaCompra ?? "9999"),
    nome: (a, b) => a.nome.localeCompare(b.nome, "pt-BR"),
    saldo: (a, b) => b.saldo - a.saldo,
    compras: (a, b) => b.compras - a.compras,
  };
  lista.sort(cmp[ordem] ?? cmp.gasto);
  const totalGasto = lista.reduce((s, c) => s + c.totalGasto, 0);
  return NextResponse.json({
    total: lista.length,
    comTelefone: lista.filter((c) => c.telefone).length,
    gastoMedio: lista.length ? Math.round(totalGasto / lista.length) : 0,
    saldoTotal: Math.round(lista.reduce((s, c) => s + c.saldo, 0) * 100) / 100,
    contagens: { faixas, lojas },
    clientes: lista.slice(0, limite),
  });
}

/** Cria ou edita uma cliente pelo painel. */
export async function POST(req: NextRequest) {
  const d = (await req.json().catch(() => ({}))) as {
    id?: string;
    nome?: string;
    telefone?: string;
    cpf?: string;
    email?: string;
    nascimento?: string;
    lojaOrigem?: string;
    optIn?: boolean;
    obs?: string;
  };
  if (d.telefone && !normalizarTelefone(d.telefone)) return NextResponse.json({ erro: "Telefone inválido. Use DDD + número." }, { status: 400 });
  try {
    const cliente = await alterarBase((b) => {
      if (d.id) {
        const c = b.clientes.find((x) => x.id === d.id);
        if (!c) throw new Error("Cliente não encontrada.");
        if (d.nome !== undefined) c.nome = d.nome.trim() || c.nome;
        if (d.telefone !== undefined) {
          const tel = normalizarTelefone(d.telefone);
          if (tel && b.clientes.some((x) => x.id !== c.id && x.telefone === tel)) throw new Error("Já existe outra cliente com esse telefone.");
          c.telefone = tel;
        }
        if (d.cpf !== undefined) c.cpf = d.cpf.replace(/\D/g, "") || undefined;
        if (d.email !== undefined) c.email = d.email.trim() || undefined;
        if (d.nascimento !== undefined) c.nascimento = d.nascimento || undefined;
        if (d.lojaOrigem !== undefined) c.lojaOrigem = d.lojaOrigem || undefined;
        if (d.optIn !== undefined) c.optIn = d.optIn;
        if (d.obs !== undefined) c.obs = d.obs.trim() || undefined;
        c.atualizadoEm = new Date().toISOString();
        return resumir(b, c);
      }
      const { cliente } = salvarCliente(b, { nome: d.nome ?? "", telefone: d.telefone, cpf: d.cpf, email: d.email, nascimento: d.nascimento, lojaOrigem: d.lojaOrigem, optIn: d.optIn ?? false, obs: d.obs }, "painel");
      return resumir(b, cliente);
    });
    return NextResponse.json({ cliente });
  } catch (e) {
    return NextResponse.json({ erro: e instanceof Error ? e.message : "Erro" }, { status: 400 });
  }
}
