import { NextRequest, NextResponse } from "next/server";
import { LOJAS } from "@/lib/connectors/totvs";
import { lojasPermitidas } from "@/lib/acesso/lojas";
import { codigoDeAparelho, sessaoDe } from "@/lib/acesso/sessao";
import { registrarAcesso } from "@/lib/crm/acessos";
import { alterarBase, hojeSp, lerBase, somarDias } from "@/lib/crm/base";
import { painel } from "@/lib/crm/painel";
import { conferir } from "@/lib/crm/conferencia";
import { produtosDaLoja, vendasDaLoja } from "@/lib/crm/vendasLoja";
import { clientesAtendidas, vendasPeloWhatsApp } from "@/lib/crm/whatsLoja";
import { nomearPendentes, telefoneVisivel } from "@/lib/crm/contatos";
import { adaptadorDe } from "@/lib/crm/envio/adaptador";
import { creditosAbertos, resgatar, saldoDe, usarOferta } from "@/lib/crm/cashback";
import { resumir, salvarCliente } from "@/lib/crm/clientes";
import { enfileirar } from "@/lib/crm/mensagens";
import { formatarTelefone, normalizarTelefone } from "@/lib/crm/telefone";
import { codigoDeIndicacao, indicadoraDoCodigo, registrarNaLoja, valeNaLoja } from "@/lib/crm/indicacao";
import { indicacaoDe } from "@/lib/crm/tipos";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * O caixa abre de dois jeitos: no aparelho da loja, com o código da TV na URL
 * (todas as lojas); ou com o usuário de cada um — o usuário de loja só vê e
 * mexe na própria loja.
 */
const foraDaLoja = (loja: string) => NextResponse.json({ erro: `Seu usuário não tem acesso à loja ${loja}.` }, { status: 403 });

function fichaCurta(base: Awaited<ReturnType<typeof lerBase>>, id: string, loja?: string) {
  const c = base.clientes.find((x) => x.id === id)!;
  const r = resumir(base, c);
  const ind = indicacaoDe(base.config);
  return {
    // Indique uma amiga: o código dela (se já tem) e as regras, nas lojas onde vale
    indicacao: loja && valeNaLoja(base, loja) ? { codigo: c.codigoIndicacao, pctAmiga: ind.pctAmiga, valor: ind.valorIndicadora } : undefined,
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
  const inicioMes = `${hojeSp().slice(0, 7)}-01`;
  const whats = vendasPeloWhatsApp(base, loja, inicioMes);
  return {
    loja,
    atualizado: new Date().toISOString(),
    modoSombra: base.config.modoSombra,
    whatsapp: { ativo: card.numero.ativo, conectado: situacao ? situacao.conectado : null },
    atendimento: card.atend,
    esperandoLista: (await nomearPendentes(base, pg.semana.pendentes.filter((p) => p.loja === loja).slice(0, 20))).map((p) => {
      const tel = telefoneVisivel(p.telefone);
      return { nome: p.nomeMostrar, cadastrada: Boolean(p.cliente), telefone: tel ? formatarTelefone(tel) : "", esperando: p.esperando, texto: p.texto };
    }),
    celular: card.cadastro,
    atendidas: clientesAtendidas(base, loja),
    peloWhats: { vendas: whats.vendas, valor: whats.valor, pctVendas: whats.pctVendas, pctValor: whats.pctValor, comEntrega: whats.comEntrega, lista: whats.lista },
    semBaixa: conferir(base, 14, loja)
      .itens.filter((i) => i.tipo === "desconto_sem_baixa")
      .slice(0, 20)
      .map((i) => ({ cliente: i.cliente, data: i.data, desconto: i.desconto, vendedora: i.vendedora })),
    vendas: await vendasDaLoja(base, loja, whats.porVendedora).catch((e) => ({ configurado: false, erro: e instanceof Error ? e.message : "erro" })),
  };
}

/** Busca por telefone, CPF ou nome; ou o painel da loja (?painel=Nome). */
export async function GET(req: NextRequest) {
  const permitidas = await lojasPermitidas(req);
  if (!permitidas) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const produtos = req.nextUrl.searchParams.get("produtos");
  if (produtos) {
    if (!Object.values(LOJAS).includes(produtos)) return NextResponse.json({ erro: "Loja não encontrada" }, { status: 400 });
    if (!permitidas.includes(produtos)) return foraDaLoja(produtos);
    const per = req.nextUrl.searchParams.get("periodo");
    const periodo = per === "7" || per === "30" ? per : "mes";
    return NextResponse.json(await produtosDaLoja(produtos, periodo).catch(() => ({ produtos: [], pecas: 0, receita: 0, incompleto: true })));
  }
  const painel = req.nextUrl.searchParams.get("painel");
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  const base = await lerBase();
  if (painel) {
    if (!Object.values(LOJAS).includes(painel)) return NextResponse.json({ erro: "Loja não encontrada" }, { status: 400 });
    if (!permitidas.includes(painel)) return foraDaLoja(painel);
    // Conta como "a loja abriu o painel" só o computador da loja ou o usuário de loja, com a aba visível
    if (req.nextUrl.searchParams.get("visivel") === "1" && (codigoDeAparelho(req) || (await sessaoDe(req))?.papel === "loja"))
      await registrarAcesso(painel).catch(() => {});
    return NextResponse.json(await painelDaLoja(base, painel));
  }
  if (!q) return NextResponse.json({ lojas: permitidas, clientes: [] });
  const dig = q.replace(/\D/g, "");
  const tel = normalizarTelefone(q);
  let lista = base.clientes.filter(
    (c) => (tel && c.telefone === tel) || (dig.length === 11 && c.cpf === dig) || (dig.length >= 8 && c.telefone?.includes(dig))
  );
  if (!lista.length && dig.length < 4) {
    const t = q.toLowerCase();
    lista = base.clientes.filter((c) => c.nome.toLowerCase().includes(t)).slice(0, 10);
  }
  const lojaQ = req.nextUrl.searchParams.get("loja") ?? undefined;
  return NextResponse.json({ lojas: permitidas, clientes: lista.slice(0, 10).map((c) => fichaCurta(base, c.id, lojaQ)) });
}

type Pedido =
  | { acao: "cadastrar"; nome: string; telefone: string; nascimento?: string; cpf?: string; loja: string; optIn: boolean }
  | { acao: "resgatar"; clienteId: string; valor: number; valorCompra?: number; loja: string; codigo?: string }
  | { acao: "codigo"; codigo: string; loja?: string }
  | { acao: "indicacao"; codigo: string; loja: string; telefone: string; nome?: string; cpf?: string; valorCompra?: number }
  | { acao: "meu-codigo"; clienteId: string; loja: string }
  | { acao: "usar-oferta"; codigo: string; loja: string; valorCompra?: number };

export async function POST(req: NextRequest) {
  const permitidas = await lojasPermitidas(req);
  if (!permitidas) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const p = (await req.json().catch(() => ({}))) as Pedido;
  if ("loja" in p && p.loja && !permitidas.includes(p.loja)) return foraDaLoja(p.loja);
  try {
    if (p.acao === "codigo") {
      const base = await lerBase();
      const cod = base.codigos.find((x) => x.codigo === p.codigo.trim().toUpperCase());
      if (!cod) {
        // Código de indicação de uma cliente (indique uma amiga)
        const ind = indicadoraDoCodigo(base, p.codigo);
        if (ind) {
          if (p.loja && !valeNaLoja(base, p.loja)) return NextResponse.json({ erro: `Esse é o código de indicação da ${ind.nome.split(" ")[0]}, mas o indique uma amiga ainda não está ligado nesta loja.` }, { status: 400 });
          const cfg = indicacaoDe(base.config);
          return NextResponse.json({ indicacao: { indicadora: ind.nome, pctAmiga: cfg.pctAmiga, valor: cfg.valorIndicadora, carenciaDias: cfg.carenciaDias } });
        }
        return NextResponse.json({ erro: "Código não encontrado." }, { status: 404 });
      }
      if (cod.usadoEm) return NextResponse.json({ erro: "Esse código já foi usado." }, { status: 400 });
      if (cod.validade < hojeSp()) return NextResponse.json({ erro: "Esse código venceu." }, { status: 400 });
      return NextResponse.json({ codigo: cod, cliente: fichaCurta(base, cod.clienteId) });
    }
    if (p.acao === "indicacao") {
      const ind = await alterarBase((b) => registrarNaLoja(b, { ...p, por: `caixa ${p.loja}` }));
      const base = await lerBase();
      const cfg = indicacaoDe(base.config);
      const quem = base.clientes.find((c) => c.id === ind.indicadoraId)?.nome.split(" ")[0] ?? "Quem indicou";
      return NextResponse.json({ ok: true, detalhe: `Indicação registrada. Pode dar ${cfg.pctAmiga}% de desconto na nota. ${quem} ganha R$ ${cfg.valorIndicadora} de cashback quando a compra for confirmada (em ${cfg.carenciaDias} dias).` });
    }
    if (p.acao === "meu-codigo") {
      const r = await alterarBase((b) => {
        if (!valeNaLoja(b, p.loja)) throw new Error("O indique uma amiga ainda não está ligado nesta loja.");
        const c = b.clientes.find((x) => x.id === p.clienteId);
        if (!c) throw new Error("Cliente não encontrada.");
        const codigo = codigoDeIndicacao(b, c);
        c.indicacaoDivulgadaEm ??= new Date().toISOString();
        return codigo;
      });
      return NextResponse.json({ codigo: r });
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
          // A cliente aceitou de novo no caixa: vale mais que um SAIR antigo
          cliente.optIn = true;
          cliente.optOut = false;
          if (cliente.telefone && b.naoContatar) delete b.naoContatar[cliente.telefone];
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
