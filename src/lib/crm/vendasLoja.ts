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
import { spDateKey } from "@/lib/types";
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

export interface VendasLoja {
  configurado: boolean;
  erro?: string;
  mes: string;
  vendido: number;
  meta: number;
  pct: number | null;
  hoje: number;
  vendas: number;
  ticket: number;
  diasRestantes: number;
  /** Quanto precisa vender por dia, de hoje até o fim do mês, pra bater a meta */
  porDia: number;
  rankingMeta: { loja: string; pct: number | null; vendido: number }[];
  vendedoras: { nome: string; vendido: number; vendas: number; ticket: number; hoje: number; comCelular: number; pctCelular: number | null }[];
  semVendedora: number;
}

export async function vendasDaLoja(base: BaseCrm, loja: string): Promise<VendasLoja> {
  const hoje = hojeSp();
  const inicioMes = `${hoje.slice(0, 7)}-01`;
  const [ano, mes] = hoje.split("-").map(Number);
  const ultimoDia = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  const diasRestantes = ultimoDia - Number(hoje.slice(8, 10)) + 1;
  const mesNome = new Date(`${inicioMes}T12:00:00`).toLocaleDateString("pt-BR", { month: "long" });
  const vazio: VendasLoja = { configurado: false, mes: mesNome, vendido: 0, meta: 0, pct: null, hoje: 0, vendas: 0, ticket: 0, diasRestantes, porDia: 0, rankingMeta: [], vendedoras: [], semVendedora: 0 };
  if (!totvsConfigured()) return vazio;

  const [r, cfg] = await Promise.all([fetchTotvsSales(inicioMes, hoje), readConfig()]);
  const metas = cfg.metas ?? {};

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

  // Celular por vendedora no mês, pelas vendas do CRM (que sabem se a cliente tem celular)
  const temCel = new Map(base.clientes.map((c) => [c.id, Boolean(c.telefone)]));
  const cel = new Map<string, number>();
  for (const v of base.vendas) {
    if (v.loja !== loja || !v.vendedoraCpf || v.data.slice(0, 10) < inicioMes || v.valor <= 0) continue;
    if (v.clienteId && temCel.get(v.clienteId)) cel.set(v.vendedoraCpf, (cel.get(v.vendedoraCpf) ?? 0) + 1);
  }

  const porVend = new Map<string, { nome: string; vendido: number; vendas: number; hoje: number; cpf?: string }>();
  let semVendedora = 0;
  for (const o of daLoja) {
    if (!o.sellerCpf) {
      semVendedora += o.total;
      continue;
    }
    const cpf = padCpf(o.sellerCpf);
    const nome = base.vendedoras?.[cpf] ?? nomes.get(cpf) ?? o.seller ?? `CPF •••${cpf.slice(3, 9)}`;
    const a = porVend.get(cpf) ?? porVend.set(cpf, { nome, vendido: 0, vendas: 0, hoje: 0, cpf }).get(cpf)!;
    a.vendido += o.total;
    a.vendas++;
    if (spDateKey(o.createdAt) === hoje) a.hoje += o.total;
  }

  return {
    configurado: true,
    erro: r.error,
    mes: mesNome,
    vendido: Math.round(vendido),
    meta,
    pct: meta > 0 ? Math.round((vendido / meta) * 100) : null,
    hoje: Math.round(daLoja.filter((o) => spDateKey(o.createdAt) === hoje).reduce((s, o) => s + o.total, 0)),
    vendas: daLoja.length,
    ticket: daLoja.length ? Math.round(vendido / daLoja.length) : 0,
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
      }))
      .sort((a, b) => b.vendido - a.vendido),
    semVendedora: Math.round(semVendedora),
  };
}

/** Produtos que mais saíram na loja nos últimos 30 dias (a busca com itens é cara; o que não couber vem marcado). */
export async function produtosDaLoja(loja: string): Promise<{ produtos: { nome: string; qtd: number; receita: number }[]; incompleto: boolean }> {
  if (!totvsConfigured()) return { produtos: [], incompleto: false };
  const hoje = hojeSp();
  const r = await fetchVendasPorProduto(somarDias(hoje, -29), hoje, 20000);
  const m = new Map<string, { nome: string; qtd: number; receita: number }>();
  for (const it of r.itens) {
    if (it.loja !== loja) continue;
    const a = m.get(it.nome) ?? m.set(it.nome, { nome: it.nome, qtd: 0, receita: 0 }).get(it.nome)!;
    a.qtd += it.qtd;
    a.receita += it.receita;
  }
  return {
    produtos: Array.from(m.values())
      .sort((a, b) => b.qtd - a.qtd || b.receita - a.receita)
      .slice(0, 12)
      .map((p) => ({ ...p, receita: Math.round(p.receita) })),
    incompleto: r.incompleto,
  };
}
