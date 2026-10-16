import { NextRequest, NextResponse } from "next/server";
import { LOJAS } from "@/lib/connectors/totvs";
import { env } from "@/lib/env";
import { alterarBase, hojeSp, lerBase, somarDias } from "@/lib/crm/base";
import { resumoAtendimento } from "@/lib/crm/atendimento";
import { creditosAbertos, resgatar, saldoDe, usarOferta } from "@/lib/crm/cashback";
import { resumir, salvarCliente } from "@/lib/crm/clientes";
import { enfileirar } from "@/lib/crm/mensagens";
import { formatarTelefone, normalizarTelefone } from "@/lib/crm/telefone";

export const dynamic = "force-dynamic";

/** O caixa da loja entra com o mesmo código da tela de metas (TV_CODE). */
function autorizado(req: NextRequest): boolean {
  const codigo = env("TV_CODE");
  // Sem senha no painel nem código configurado, fica aberto (igual às outras telas)
  if (!env("DASHBOARD_PASSWORD") && !codigo) return true;
  return Boolean(codigo) && req.nextUrl.searchParams.get("k") === codigo;
}

function fichaCurta(base: Awaited<ReturnType<typeof lerBase>>, id: string) {
  const c = base.clientes.find((x) => x.id === id)!;
  const r = resumir(base, c);
  return {
    id: c.id,
    nome: c.nome,
    telefone: formatarTelefone(c.telefone),
    nascimento: c.nascimento,
    optIn: c.optIn,
    optOut: c.optOut,
    saldo: r.saldo,
    compras: r.compras,
    totalGasto: r.totalGasto,
    ultimaCompra: r.ultimaCompra,
    creditos: creditosAbertos(base, c.id).map((x) => ({ valor: x.restante, validade: x.validade })),
    resgateMinimo: base.config.cashbackResgateMinimo,
    maxPctDaCompra: base.config.cashbackMaxPctDaCompra,
    multiploCompra: base.config.cashbackMultiploCompra,
  };
}

/** Painel da loja: os números dela e o que dá pra fazer hoje. */
function painelDaLoja(base: Awaited<ReturnType<typeof lerBase>>, loja: string) {
  const hoje = hojeSp();
  const mes = hoje.slice(5, 7);
  const lojasFisicas = Object.values(LOJAS);
  const lojaDe = new Map<string, string>();
  // A cliente é "da loja" onde comprou por último (ou onde foi cadastrada)
  const ultima = new Map<string, { data: string; loja: string }>();
  for (const v of base.vendas) {
    if (!v.clienteId) continue;
    const u = ultima.get(v.clienteId);
    if (!u || v.data > u.data) ultima.set(v.clienteId, { data: v.data, loja: v.loja });
  }
  for (const c of base.clientes) lojaDe.set(c.id, ultima.get(c.id)?.loja ?? c.lojaOrigem ?? "");

  const minhas = base.clientes.filter((c) => lojaDe.get(c.id) === loja);
  const comTel = minhas.filter((c) => c.telefone).length;
  const semana = somarDias(hoje, -7);
  const cadastradasSemana = minhas.filter((c) => c.criadoEm.slice(0, 10) >= semana && c.lojaOrigem === loja && !c.codigoTotvs).length;

  const ranking = lojasFisicas
    .map((l) => {
      const cs = base.clientes.filter((c) => lojaDe.get(c.id) === l);
      return { loja: l, clientes: cs.length, pct: cs.length ? Math.round((cs.filter((c) => c.telefone).length / cs.length) * 100) : 0 };
    })
    .filter((x) => x.clientes > 0)
    .sort((a, b) => b.pct - a.pct);

  const aniversariantes = minhas
    .filter((c) => c.nascimento?.slice(5, 7) === mes && c.nascimento.slice(8, 10) >= hoje.slice(8, 10))
    .map((c) => ({ nome: c.nome, telefone: formatarTelefone(c.telefone), dia: c.nascimento!.slice(8, 10) }))
    .sort((a, b) => a.dia.localeCompare(b.dia));

  const vencendo = minhas
    .map((c) => {
      const cred = creditosAbertos(base, c.id).filter((x) => x.validade <= somarDias(hoje, 14));
      const valor = cred.reduce((s, x) => s + x.restante, 0);
      return valor > 0 ? { nome: c.nome, telefone: formatarTelefone(c.telefone), valor: Math.round(valor * 100) / 100, validade: cred[0].validade } : null;
    })
    .filter((x): x is NonNullable<typeof x> => Boolean(x))
    .sort((a, b) => a.validade.localeCompare(b.validade));

  let saldoTotal = 0;
  let comSaldo = 0;
  for (const c of minhas) {
    const s = saldoDe(base, c.id);
    if (s > 0) {
      comSaldo++;
      saldoTotal += s;
    }
  }
  const atend = resumoAtendimento(base, 1);
  return {
    loja,
    clientes: minhas.length,
    comTelefone: comTel,
    pctTelefone: minhas.length ? Math.round((comTel / minhas.length) * 100) : 0,
    cadastradasSemana,
    ranking,
    aniversariantes: aniversariantes.slice(0, 40),
    vencendo: vencendo.slice(0, 40),
    comSaldo,
    saldoTotal: Math.round(saldoTotal * 100) / 100,
    esperando: atend.pendentes.filter((p) => p.loja === loja).length,
    modoSombra: base.config.modoSombra,
  };
}

/** Busca por telefone, CPF ou nome; ou o painel da loja (?painel=Nome). */
export async function GET(req: NextRequest) {
  if (!autorizado(req)) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const painel = req.nextUrl.searchParams.get("painel");
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  const base = await lerBase();
  if (painel) {
    if (!Object.values(LOJAS).includes(painel)) return NextResponse.json({ erro: "Loja não encontrada" }, { status: 400 });
    return NextResponse.json(painelDaLoja(base, painel));
  }
  if (!q) return NextResponse.json({ lojas: Object.values(LOJAS), clientes: [] });
  const dig = q.replace(/\D/g, "");
  const tel = normalizarTelefone(q);
  let lista = base.clientes.filter(
    (c) => (tel && c.telefone === tel) || (dig.length === 11 && c.cpf === dig) || (dig.length >= 8 && c.telefone?.includes(dig))
  );
  if (!lista.length && dig.length < 4) {
    const t = q.toLowerCase();
    lista = base.clientes.filter((c) => c.nome.toLowerCase().includes(t)).slice(0, 10);
  }
  return NextResponse.json({ lojas: Object.values(LOJAS), clientes: lista.slice(0, 10).map((c) => fichaCurta(base, c.id)) });
}

type Pedido =
  | { acao: "cadastrar"; nome: string; telefone: string; nascimento?: string; cpf?: string; loja: string; optIn: boolean }
  | { acao: "resgatar"; clienteId: string; valor: number; valorCompra?: number; loja: string; codigo?: string }
  | { acao: "codigo"; codigo: string }
  | { acao: "usar-oferta"; codigo: string; loja: string; valorCompra?: number };

export async function POST(req: NextRequest) {
  if (!autorizado(req)) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const p = (await req.json().catch(() => ({}))) as Pedido;
  try {
    if (p.acao === "codigo") {
      const base = await lerBase();
      const cod = base.codigos.find((x) => x.codigo === p.codigo.trim().toUpperCase());
      if (!cod) return NextResponse.json({ erro: "Código não encontrado." }, { status: 404 });
      if (cod.usadoEm) return NextResponse.json({ erro: "Esse código já foi usado." }, { status: 400 });
      if (cod.validade < hojeSp()) return NextResponse.json({ erro: "Esse código venceu." }, { status: 400 });
      return NextResponse.json({ codigo: cod, cliente: fichaCurta(base, cod.clienteId) });
    }
    if (p.acao === "usar-oferta") {
      const r = await alterarBase((b) => usarOferta(b, p.codigo, p.loja, p.valorCompra));
      const base = await lerBase();
      return NextResponse.json({ codigo: r, cliente: fichaCurta(base, r.clienteId) });
    }
    if (p.acao === "cadastrar") {
      if (!normalizarTelefone(p.telefone)) return NextResponse.json({ erro: "Telefone inválido. Use DDD + número." }, { status: 400 });
      const r = await alterarBase((b) => {
        const { cliente, nova } = salvarCliente(b, { nome: p.nome, telefone: p.telefone, nascimento: p.nascimento, cpf: p.cpf, lojaOrigem: p.loja, optIn: p.optIn }, "loja");
        if (p.optIn) {
          cliente.optIn = true;
          cliente.optOut = false;
        }
        let boasVindas = false;
        if (nova && p.optIn) boasVindas = Boolean(enfileirar(b, { cliente, campanha: "boas_vindas", loja: p.loja, chave: `bv-${cliente.id}` }).mensagem);
        return { id: cliente.id, nova, boasVindas };
      });
      const base = await lerBase();
      return NextResponse.json({ ...r, cliente: fichaCurta(base, r.id) });
    }
    if (p.acao === "resgatar") {
      const r = await alterarBase((b) => {
        const mov = resgatar(b, { clienteId: p.clienteId, valor: p.valor, valorCompra: p.valorCompra, loja: p.loja, codigo: p.codigo?.trim().toUpperCase() || undefined, por: `caixa ${p.loja}` });
        return { movimento: mov, saldo: saldoDe(b, p.clienteId) };
      });
      return NextResponse.json(r);
    }
    return NextResponse.json({ erro: "Ação desconhecida." }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ erro: e instanceof Error ? e.message : "Erro" }, { status: 400 });
  }
}
