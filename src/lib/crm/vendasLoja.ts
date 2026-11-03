/**
 * Vendas da loja pro painel da loja: o mês contra a meta, cada vendedora
 * (vendido, vendas, ticket e quantas saíram com o celular da cliente), a
 * posição entre as lojas e os produtos que mais saíram.
 *
 * Usa a mesma busca de vendas do dashboard (com cache) e aproveita para
 * aprender o nome de cada vendedora pelo CPF da nota.
 */

import { LOJAS, fetchTotvsSales, fetchVendasPorProduto, totvsConfigured } from "@/lib/connectors/totvs";
import { readConfig } from "@/lib/config";
import { contaComoPedido, ehCompraDeFuncionaria, pedidosEm, spDateKey } from "@/lib/types";
import { alterarBase, hojeSp, somarDias } from "./base";
import type { BaseCrm } from "./tipos";

const padCpf = (c: string) => c.replace(/\D/g, "").padStart(11, "0");
const nomeBonito = (n: string) =>
  n
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
    .join(" ");

/** Aprende o nome das vendedoras pelo CPF das notas dos últimos 60 dias (pra Análise e o detalhe da loja). */
export async function aprenderVendedoras(base: BaseCrm): Promise<void> {
  if (!totvsConfigured()) return;
  const hoje = hojeSp();
  const r = await fetchTotvsSales(somarDias(hoje, -60), hoje).catch(() => null);
  if (!r) return;
  const novos = new Map<string, string>();
  for (const o of r.orders) {
    if (!o.sellerCpf || !o.seller || /^CPF /.test(o.seller)) continue;
    const cpf = padCpf(o.sellerCpf);
    if (!base.vendedoras?.[cpf]) novos.set(cpf, o.seller);
  }
  if (!novos.size) return;
  await alterarBase((b) => {
    b.vendedoras ??= {};
    for (const [cpf, nome] of novos) b.vendedoras[cpf] = nome;
  });
  for (const [cpf, nome] of novos) (base.vendedoras ??= {})[cpf] = nome;
}

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

/** O período escolhido na tela da loja, já conferido, e como chamá-lo nos títulos. */
export interface PeriodoLoja {
  de: string;
  ate: string;
  /** "novembro", "outubro de 2025", "hoje", "27/10 a 02/11" */
  rotulo: string;
  /** Um mês inteiro (ou o mês atual até hoje) */
  mesInteiro: boolean;
  /** O mês atual: o único com meta, porque só a meta de agora fica guardada */
  mesAtual: boolean;
  /** O período vai até hoje */
  temHoje: boolean;
}

/** Sem datas (ou com datas inválidas) é o mês atual; nada depois de hoje nem mais de 400 dias. */
export function periodoDaLoja(deQ?: string | null, ateQ?: string | null): PeriodoLoja {
  const hoje = hojeSp();
  const data = (d?: string | null) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null);
  let ate = data(ateQ) ?? hoje;
  if (ate > hoje) ate = hoje;
  let de = data(deQ) ?? `${hoje.slice(0, 7)}-01`;
  if (de > ate) de = ate;
  if (de < somarDias(ate, -400)) de = somarDias(ate, -400);
  const [a, m] = de.split("-").map(Number);
  const fimDoMes = new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10);
  const mesInteiro = de.endsWith("-01") && de.slice(0, 7) === ate.slice(0, 7) && (ate === fimDoMes || ate === hoje);
  const anoAtual = hoje.slice(0, 4);
  const dm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}${d.slice(0, 4) === anoAtual ? "" : `/${d.slice(2, 4)}`}`;
  const rotulo = mesInteiro
    ? `${MESES[m - 1]}${String(a) === anoAtual ? "" : ` de ${a}`}`
    : de === ate
      ? de === hoje
        ? "hoje"
        : dm(de)
      : `${dm(de)} a ${dm(ate)}`;
  return { de, ate, rotulo, mesInteiro, mesAtual: mesInteiro && de.slice(0, 7) === hoje.slice(0, 7), temHoje: ate === hoje };
}

export interface VendasLoja {
  configurado: boolean;
  erro?: string;
  /** Nome do período nos títulos (era só o mês) */
  mes: string;
  periodo: PeriodoLoja;
  vendido: number;
  meta: number;
  pct: number | null;
  hoje: number;
  vendas: number;
  ticket: number;
  /** Vendido por dia no período */
  mediaDia: number;
  diasRestantes: number;
  /** Quanto precisa vender por dia, de hoje até o fim do mês, pra bater a meta */
  porDia: number;
  rankingMeta: { loja: string; pct: number | null; vendido: number }[];
  vendedoras: { nome: string; vendido: number; vendas: number; ticket: number; hoje: number; comCelular: number; pctCelular: number | null; peloWhats: number }[];
  semVendedora: number;
  /** Compras de funcionárias (fatura): da loja, mas fora das vendedoras */
  funcionarias: number;
}

/**
 * Vendas da loja no período (o mês atual, se não vier outro). A meta só
 * entra no mês atual: a meta guardada é a de agora, e comparar um mês
 * passado com ela seria comparar com um número que talvez nem valesse.
 */
export async function vendasDaLoja(
  base: BaseCrm,
  loja: string,
  peloWhats?: Map<string, { n: number; valor: number }>,
  per: PeriodoLoja = periodoDaLoja()
): Promise<VendasLoja> {
  const hoje = hojeSp();
  const [ano, mes] = hoje.split("-").map(Number);
  const ultimoDia = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  const diasRestantes = ultimoDia - Number(hoje.slice(8, 10)) + 1;
  const dias = Math.round((Date.parse(per.ate) - Date.parse(per.de)) / 86400000) + 1;
  const vazio: VendasLoja = { configurado: false, mes: per.rotulo, periodo: per, vendido: 0, meta: 0, pct: null, hoje: 0, vendas: 0, ticket: 0, mediaDia: 0, diasRestantes, porDia: 0, rankingMeta: [], vendedoras: [], semVendedora: 0, funcionarias: 0 };
  if (!totvsConfigured()) return vazio;

  const [r, cfg] = await Promise.all([fetchTotvsSales(per.de, per.ate), readConfig()]);
  const metas = per.mesAtual ? (cfg.metas ?? {}) : {};

  // Nome de cada vendedora pelo CPF (o dashboard já traduz); guarda os novos no CRM
  const nomes = new Map<string, string>();
  for (const o of r.orders) if (o.sellerCpf && o.seller && !/^CPF /.test(o.seller)) nomes.set(padCpf(o.sellerCpf), o.seller);
  const novos = Array.from(nomes).filter(([cpf]) => !base.vendedoras?.[cpf]);
  if (novos.length)
    await alterarBase((b) => {
      b.vendedoras ??= {};
      for (const [cpf, nome] of novos) b.vendedoras[cpf] = nome;
    });

  const rankingMeta = Object.values(LOJAS)
    .map((l) => {
      const vendido = r.orders.filter((o) => o.store === l).reduce((s, o) => s + o.total, 0);
      const meta = metas[l] ?? 0;
      return { loja: l, vendido: Math.round(vendido), pct: meta > 0 ? Math.round((vendido / meta) * 100) : null };
    })
    .sort((a, b) => (b.pct ?? -1) - (a.pct ?? -1) || b.vendido - a.vendido);

  const daLoja = r.orders.filter((o) => o.store === loja);
  const vendido = daLoja.reduce((s, o) => s + o.total, 0);
  const meta = metas[loja] ?? 0;

  // Celular por vendedora no período, pelas vendas do CRM (que sabem se a cliente tem celular)
  const temCel = new Map(base.clientes.map((c) => [c.id, Boolean(c.telefone)]));
  const cel = new Map<string, number>();
  for (const v of base.vendas) {
    const dia = v.data.slice(0, 10);
    if (v.loja !== loja || !v.vendedoraCpf || dia < per.de || dia > per.ate || v.valor <= 0) continue;
    if (v.clienteId && temCel.get(v.clienteId)) cel.set(v.vendedoraCpf, (cel.get(v.vendedoraCpf) ?? 0) + 1);
  }

  const porVend = new Map<string, { nome: string; vendido: number; vendas: number; hoje: number; cpf?: string }>();
  let semVendedora = 0;
  let funcionarias = 0;
  for (const o of daLoja) {
    if (ehCompraDeFuncionaria(o)) {
      funcionarias += o.total;
      continue;
    }
    if (!o.sellerCpf) {
      semVendedora += o.total;
      continue;
    }
    const cpf = padCpf(o.sellerCpf);
    const nome = base.vendedoras?.[cpf] ?? nomes.get(cpf) ?? o.seller ?? `CPF •••${cpf.slice(3, 9)}`;
    const a = porVend.get(cpf) ?? porVend.set(cpf, { nome, vendido: 0, vendas: 0, hoje: 0, cpf }).get(cpf)!;
    a.vendido += o.total;
    if (contaComoPedido(o)) a.vendas++;
    if (spDateKey(o.createdAt) === hoje) a.hoje += o.total;
  }

  return {
    configurado: true,
    erro: r.error,
    mes: per.rotulo,
    periodo: per,
    vendido: Math.round(vendido),
    meta,
    pct: meta > 0 ? Math.round((vendido / meta) * 100) : null,
    hoje: Math.round(daLoja.filter((o) => spDateKey(o.createdAt) === hoje).reduce((s, o) => s + o.total, 0)),
    vendas: pedidosEm(daLoja),
    ticket: pedidosEm(daLoja) ? Math.round(vendido / pedidosEm(daLoja)) : 0,
    mediaDia: Math.round(vendido / Math.max(1, dias)),
    diasRestantes,
    porDia: meta > vendido && diasRestantes > 0 ? Math.round((meta - vendido) / diasRestantes) : 0,
    rankingMeta,
    vendedoras: Array.from(porVend.values())
      .map((v) => ({
        nome: nomeBonito(v.nome),
        vendido: Math.round(v.vendido),
        vendas: v.vendas,
        ticket: v.vendas ? Math.round(v.vendido / v.vendas) : 0,
        hoje: Math.round(v.hoje),
        comCelular: cel.get(v.cpf!) ?? 0,
        pctCelular: v.vendas ? Math.round(((cel.get(v.cpf!) ?? 0) / v.vendas) * 100) : null,
        peloWhats: peloWhats?.get(v.cpf!)?.n ?? 0,
      }))
      .sort((a, b) => b.vendido - a.vendido),
    semVendedora: Math.round(semVendedora),
    funcionarias: Math.round(funcionarias),
  };
}

/** Frete, motoboy e taxa de entrega aparecem como item na nota, mas não são produto. */
const NAO_PRODUTO = /FRETE|MOTO ?BOY|ENTREGA|TAXA DE|SACOLA|EMBALAGEM PRESENTE/i;

/** Produtos vendidos na loja no período (sem frete), com quantidade e valor. */
export async function produtosDaLoja(
  loja: string,
  per: PeriodoLoja = periodoDaLoja()
): Promise<{ produtos: { nome: string; qtd: number; receita: number }[]; pecas: number; receita: number; incompleto: boolean; de: string }> {
  const de = per.de;
  if (!totvsConfigured()) return { produtos: [], pecas: 0, receita: 0, incompleto: false, de };
  const r = await fetchVendasPorProduto(de, per.ate, 20000);
  const m = new Map<string, { nome: string; qtd: number; receita: number }>();
  for (const it of r.itens) {
    if (it.loja !== loja || NAO_PRODUTO.test(it.nome)) continue;
    const a = m.get(it.nome) ?? m.set(it.nome, { nome: it.nome, qtd: 0, receita: 0 }).get(it.nome)!;
    a.qtd += it.qtd;
    a.receita += it.receita;
  }
  const todos = Array.from(m.values());
  return {
    produtos: todos
      .sort((a, b) => b.qtd - a.qtd || b.receita - a.receita)
      .slice(0, 60)
      .map((p) => ({ ...p, receita: Math.round(p.receita) })),
    pecas: todos.reduce((s, p) => s + p.qtd, 0),
    receita: Math.round(todos.reduce((s, p) => s + p.receita, 0)),
    incompleto: r.incompleto,
    de,
  };
}
