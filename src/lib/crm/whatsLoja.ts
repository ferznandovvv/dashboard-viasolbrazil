/**
 * O WhatsApp da loja em números: quantas clientes ela atendeu e quais vendas
 * passaram pelo WhatsApp.
 *
 * "Venda pelo WhatsApp" é uma venda em que:
 * - a nota tem frete de motoboy/entrega (só se vende assim à distância), ou
 * - a cliente conversou com o número da loja nos 7 dias antes da compra.
 * Não prova que a conversa fechou a venda, mas é o sinal mais honesto que
 * dá pra ter sem a vendedora marcar uma a uma.
 */

import { hojeSp } from "./base";
import type { BaseCrm } from "./tipos";

const meiaNoiteSp = (dia: string) => new Date(`${dia}T00:00:00-03:00`).getTime();
const SETE_DIAS = 7 * 86400000;

/** Clientes diferentes que escreveram pro número da loja: hoje, 7 dias e no mês. */
export function clientesAtendidas(base: BaseCrm, loja: string) {
  const hoje = hojeSp();
  const tHoje = meiaNoiteSp(hoje);
  const t7 = Date.now() - SETE_DIAS;
  const tMes = meiaNoiteSp(`${hoje.slice(0, 7)}-01`);
  const s = { hoje: new Set<string>(), semana: new Set<string>(), mes: new Set<string>() };
  for (const a of base.atendimento) {
    if (a.loja !== loja || a.de !== "cliente") continue;
    const t = new Date(a.em).getTime();
    if (t >= tMes) s.mes.add(a.telefone);
    if (t >= t7) s.semana.add(a.telefone);
    if (t >= tHoje) s.hoje.add(a.telefone);
  }
  return { hoje: s.hoje.size, semana: s.semana.size, mes: s.mes.size };
}

export interface VendaWhats {
  cliente: string;
  data: string;
  valor: number;
  vendedora?: string;
  motivo: string;
}

export function vendasPeloWhatsApp(base: BaseCrm, loja: string, desde: string) {
  // Quando cada telefone escreveu pra esta loja
  const conversas = new Map<string, number[]>();
  for (const a of base.atendimento) {
    if (a.loja !== loja || a.de !== "cliente") continue;
    (conversas.get(a.telefone) ?? conversas.set(a.telefone, []).get(a.telefone)!).push(new Date(a.em).getTime());
  }
  const cliente = new Map(base.clientes.map((c) => [c.id, c]));
  const nomeVend = (cpf?: string) =>
    cpf ? base.vendedoras?.[cpf]?.split(/\s+/).slice(0, 2).map((p) => p.charAt(0) + p.slice(1).toLowerCase()).join(" ") : undefined;

  let total = 0;
  let totalValor = 0;
  const lista: VendaWhats[] = [];
  const porVendedora = new Map<string, { n: number; valor: number }>();
  for (const v of base.vendas) {
    if (v.loja !== loja || v.valor <= 0 || v.data.slice(0, 10) < desde) continue;
    total++;
    totalValor += v.valor;
    const c = v.clienteId ? cliente.get(v.clienteId) : undefined;
    const t = new Date(v.data).getTime();
    const conversou = c?.telefone ? (conversas.get(c.telefone) ?? []).filter((x) => x <= t + 3600000 && x >= t - SETE_DIAS).sort((a, b) => b - a)[0] : undefined;
    if (!v.entrega && !conversou) continue;
    const motivo = v.entrega
      ? "entrega por motoboy"
      : `conversou no WhatsApp em ${new Date(conversou!).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "America/Sao_Paulo" })}`;
    lista.push({ cliente: c?.nome ?? v.nomeNaNota ?? "Cliente sem cadastro", data: v.data, valor: Math.round(v.valor * 100) / 100, vendedora: nomeVend(v.vendedoraCpf), motivo });
    if (v.vendedoraCpf) {
      const a = porVendedora.get(v.vendedoraCpf) ?? porVendedora.set(v.vendedoraCpf, { n: 0, valor: 0 }).get(v.vendedoraCpf)!;
      a.n++;
      a.valor += v.valor;
    }
  }
  lista.sort((a, b) => b.data.localeCompare(a.data));
  const valor = lista.reduce((s, x) => s + x.valor, 0);
  return {
    vendas: lista.length,
    valor: Math.round(valor),
    pctVendas: total ? Math.round((lista.length / total) * 100) : null,
    pctValor: totalValor ? Math.round((valor / totalValor) * 100) : null,
    comEntrega: base.vendas.some((v) => v.loja === loja && v.entrega !== undefined && v.data.slice(0, 10) >= desde),
    lista: lista.slice(0, 15),
    porVendedora,
  };
}
