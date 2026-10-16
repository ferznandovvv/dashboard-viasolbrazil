/**
 * Automações do dia: rodam uma vez por dia (agendador ou botão da tela) e
 * só põem mensagens na fila. Quem manda, e em que ritmo, é a fila.
 */

import { alterarBase, diasEntre, hojeSp, somarDias } from "./base";
import { creditosAbertos, expirarCreditos, vencendoAte } from "./cashback";
import { resumir } from "./clientes";
import { ehMarketing, enfileirar } from "./mensagens";
import type { BaseCrm } from "./tipos";

/** Reativações por loja por dia: evita encher a fila de uma vez. */
const REATIVACOES_POR_LOJA_DIA = 10;

export interface ResultadoAutomacoes {
  dia: string;
  expirados: number;
  semResposta: number;
  enfileiradas: Record<string, number>;
  puladas: Record<string, number>;
}

export function rodarAutomacoesEm(b: BaseCrm, hoje = hojeSp()): ResultadoAutomacoes {
  const r: ResultadoAutomacoes = { dia: hoje, expirados: 0, semResposta: 0, enfileiradas: {}, puladas: {} };
  const conta = (mapa: Record<string, number>, k: string) => (mapa[k] = (mapa[k] ?? 0) + 1);
  const tentar = (campanha: string, res: { mensagem?: unknown; motivo?: string }) =>
    res.mensagem ? conta(r.enfileiradas, campanha) : conta(r.puladas, `${campanha}: ${res.motivo}`);

  r.expirados = expirarCreditos(b, hoje);

  // Marketing mandado há mais de 7 dias sem resposta conta contra a cliente
  const limite = new Date(Date.now() - 7 * 86400000).toISOString();
  for (const m of b.mensagens) {
    if (m.avaliada || !m.enviadoEm || m.enviadoEm > limite || !ehMarketing(m.campanha)) continue;
    if (!["enviada", "entregue", "lida"].includes(m.status)) continue;
    m.avaliada = true;
    const c = b.clientes.find((x) => x.id === m.clienteId);
    if (c) {
      c.semResposta += 1;
      r.semResposta++;
    }
  }

  const porId = new Map(b.clientes.map((c) => [c.id, c]));

  // Cliente que só comprou no site é cuidada pelo CRM do e-commerce, a não
  // ser que a configuração diga o contrário. Avisos de cashback do site
  // passam só quando o cashback do site está ligado.
  const lojasDe = new Map<string, Set<string>>();
  for (const v of b.vendas) if (v.clienteId) (lojasDe.get(v.clienteId) ?? lojasDe.set(v.clienteId, new Set()).get(v.clienteId)!).add(v.loja);
  const soSite = (id: string) => {
    const lojas = lojasDe.get(id);
    const c = porId.get(id);
    return Boolean(lojas && lojas.size === 1 && lojas.has("Site") && !c?.codigoTotvs && c?.lojaOrigem === "Site");
  };
  const participa = (id: string) => b.config.siteNasAutomacoes || !soSite(id);

  // Cashback creditado: créditos dos últimos 3 dias ainda não avisados
  const desde = somarDias(hoje, -3);
  for (const mov of b.cashback) {
    if (mov.tipo !== "credito" || mov.criadoEm.slice(0, 10) < desde) continue;
    const c = porId.get(mov.clienteId);
    if (!c) continue;
    tentar(
      "cashback_creditado",
      enfileirar(b, { cliente: c, campanha: "cashback_creditado", loja: mov.loja, variaveis: { valor: mov.valor, validade: mov.validade }, chave: `cb-credito-${mov.id}` })
    );
  }

  // Cashback vencendo
  const ate = somarDias(hoje, b.config.avisoVencimentoDias);
  for (const c of b.clientes) {
    const v = vencendoAte(b, c.id, ate, hoje);
    if (v.valor <= 0 || !v.em) continue;
    const credito = creditosAbertos(b, c.id, hoje).find((x) => x.validade === v.em);
    tentar(
      "cashback_vencendo",
      enfileirar(b, { cliente: c, campanha: "cashback_vencendo", loja: c.lojaOrigem, variaveis: { valor: v.valor, validade: v.em }, chave: `cb-venc-${c.id}-${credito?.movimentoId ?? v.em}` })
    );
  }

  // Aniversário do dia
  const mmdd = hoje.slice(5);
  for (const c of b.clientes) {
    if (!c.nascimento || c.nascimento.slice(5) !== mmdd || !participa(c.id)) continue;
    tentar("aniversario", enfileirar(b, { cliente: c, campanha: "aniversario", loja: c.lojaOrigem, chave: `aniv-${c.id}-${hoje.slice(0, 4)}` }));
  }

  // Pós-venda
  const diaPos = somarDias(hoje, -b.config.posVendaDias);
  for (const v of b.vendas) {
    if (!v.clienteId || v.data.slice(0, 10) !== diaPos || !participa(v.clienteId)) continue;
    const c = porId.get(v.clienteId);
    if (c) tentar("pos_venda", enfileirar(b, { cliente: c, campanha: "pos_venda", loja: v.loja, chave: `pos-${v.id}` }));
  }

  // Reativação: boas clientes paradas, poucas por loja por dia, respeitando o intervalo
  const porLoja = new Map<string, number>();
  const candidatas = b.clientes
    .map((c) => resumir(b, c, hoje))
    .filter((x) => participa(x.id))
    .filter((x) => x.podeMarketing && x.totalGasto >= b.config.reativacaoTicketMinimo && x.ultimaCompra && diasEntre(x.ultimaCompra, hoje) >= b.config.reativacaoDias)
    .filter((x) => {
      const ultima = b.mensagens
        .filter((m) => m.clienteId === x.id && m.campanha === "reativacao" && m.status !== "cancelada")
        .sort((p, q) => q.criadoEm.localeCompare(p.criadoEm))[0];
      return !ultima || diasEntre(ultima.criadoEm.slice(0, 10), hoje) >= b.config.reativacaoIntervaloDias;
    })
    .sort((p, q) => q.totalGasto - p.totalGasto);
  for (const x of candidatas) {
    const loja = x.ultimaLoja ?? x.lojaOrigem ?? "";
    if ((porLoja.get(loja) ?? 0) >= REATIVACOES_POR_LOJA_DIA) continue;
    const res = enfileirar(b, { cliente: x, campanha: "reativacao", loja, chave: `reat-${x.id}-${hoje}` });
    tentar("reativacao", res);
    if (res.mensagem) porLoja.set(loja, (porLoja.get(loja) ?? 0) + 1);
  }

  b.config.ultimaAutomacao = hoje;
  return r;
}

/** Roda as automações do dia, uma vez só por dia (a não ser que `forcar`). */
export async function rodarAutomacoes(forcar = false): Promise<ResultadoAutomacoes | null> {
  const hoje = hojeSp();
  return alterarBase((b) => {
    if (!forcar && b.config.ultimaAutomacao === hoje) return null;
    return rodarAutomacoesEm(b, hoje);
  });
}
