import { NextRequest, NextResponse } from "next/server";
import { LOJAS } from "@/lib/connectors/totvs";
import { env } from "@/lib/env";
import { alterarBase, hojeSp, lerBase, somarDias } from "@/lib/crm/base";
import { detalheLoja, painel } from "@/lib/crm/painel";
import { adaptadorDe } from "@/lib/crm/envio/adaptador";
import { creditosAbertos, resgatar, saldoDe, usarOferta } from "@/lib/crm/cashback";
import { resumir, salvarCliente } from "@/lib/crm/clientes";
import { enfileirar } from "@/lib/crm/mensagens";
import { formatarTelefone, normalizarTelefone } from "@/lib/crm/telefone";

export const dynamic = "force-dynamic";

/** Mesmo hash do middleware: o cookie do login do painel também vale aqui. */
function cookieEsperado(senha: string): string {
  let h = 0x811c9dc5;
  const t = `viasol:${senha}`;
  for (let i = 0; i < t.length; i++) {
    h ^= t.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16);
}

/**
 * O caixa da loja entra de dois jeitos: com o código da tela de metas (TV_CODE)
 * na URL, no celular da loja; ou logado no painel, no computador.
 */
function autorizado(req: NextRequest): boolean {
  const senha = env("DASHBOARD_PASSWORD");
  const codigo = env("TV_CODE");
  if (!senha && !codigo) return true;
  if (codigo && req.nextUrl.searchParams.get("k") === codigo) return true;
  if (senha && req.cookies.get("vs_auth")?.value === cookieEsperado(senha)) return true;
  return false;
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

/**
 * Painel da loja: atendimento no WhatsApp, captura de celular nas vendas e
 * a posição dela entre as lojas (pra ter competição), mais o % por vendedora.
 */
async function painelDaLoja(base: Awaited<ReturnType<typeof lerBase>>, loja: string) {
  const pg = painel(base);
  const card = pg.lojas.find((l) => l.loja === loja)!;
  const n = base.config.numeros.find((x) => x.loja === loja);
  const adaptador = adaptadorDe(base.config);
  const situacao = adaptador && n?.ativo && n.sessao ? await adaptador.situacao(n.sessao).catch(() => null) : null;
  const rankingCelular = pg.lojas
    .filter((l) => l.cadastro.vendas30 > 0)
    .map((l) => ({ loja: l.loja, pct: l.cadastro.pct30 ?? 0, vendas: l.cadastro.vendas30 }))
    .sort((a, b) => b.pct - a.pct);
  const rankingResposta = pg.lojas
    .filter((l) => l.numero.ativo && l.atend.mediana7d !== null)
    .map((l) => ({ loja: l.loja, mediana: l.atend.mediana7d!, rapidas: l.atend.rapidas7d }))
    .sort((a, b) => a.mediana - b.mediana);
  return {
    loja,
    atualizado: new Date().toISOString(),
    modoSombra: base.config.modoSombra,
    whatsapp: { ativo: card.numero.ativo, conectado: situacao ? situacao.conectado : null },
    atendimento: card.atend,
    esperandoLista: pg.semana.pendentes
      .filter((p) => p.loja === loja)
      .slice(0, 20)
      .map((p) => ({ nome: p.cliente, telefone: formatarTelefone(p.telefone), esperando: p.esperando, texto: p.texto })),
    celular: card.cadastro,
    rankingCelular,
    rankingResposta,
    vendedoras: detalheLoja(base, loja, 30).vendedoras,
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
    return NextResponse.json(await painelDaLoja(base, painel));
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
