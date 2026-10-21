/**
 * Campanhas manuais: escolhe um público (loja, faixa, filtros), confere quem
 * recebe antes de mandar e espalha as mensagens no tempo, por número.
 * Também mede o que cada campanha rendeu.
 */

import { hojeSp, novoId, somarDias } from "./base";
import { saldoDe, creditosAbertos } from "./cashback";
import { enviadasHoje } from "./fila";
import { assinatura, compraMinimaPara, enfileirar, lojaDeEnvio, motivoBloqueio, renderizar } from "./mensagens";
import { type Perfil, perfis } from "./perfil";
import { CAMPANHAS, contaComoCompra, tetoDoNumero, valorLiquido, type BaseCrm, type CampanhaManual, type Cliente, type FaixaCliente, type FiltroCampanha, type Mensagem } from "./tipos";

export interface Previa {
  /** Clientes no filtro (antes das regras de envio) */
  noFiltro: number;
  /** Dessas, quantas podem receber pelas regras (telefone, aceite, limite do mês, loja com número) */
  podem: number;
  /** Quantas vão receber (podem, cortado no máximo escolhido) */
  recebem: number;
  /** Quem ficou de fora pelas regras, agrupado; `detalhe` abre por loja quando é "loja sem número" */
  fora: { motivo: string; n: number; detalhe?: { loja: string; n: number }[] }[];
  /** Por número que vai mandar */
  porLoja: { loja: string; n: number; teto: number; jaHoje: number; naFila: number }[];
  /** Contagem por faixa com os outros filtros (menos faixa), pra mostrar nos botões */
  faixas: Record<FaixaCliente, number>;
  /** Contagem por loja com os outros filtros (menos loja) */
  lojas: Record<string, number>;
  amostra: { nome: string; faixa: FaixaCliente; total: number; compras: number; ultima?: string; loja?: string }[];
  /** A mensagem renderizada para as primeiras clientes, alternando as versões */
  exemplos: { nome: string; loja: string; texto: string }[];
  /** Minutos que leva no mínimo, pelo intervalo mínimo entre mensagens do mesmo número */
  minimoMin: number;
  modoSombra: boolean;
}

function noFiltro(c: Cliente, p: Perfil | undefined, f: FiltroCampanha, hoje: string, saldo: (id: string) => number, ignorar?: "faixa" | "loja"): boolean {
  if (ignorar !== "loja" && f.lojas.length && !f.lojas.includes(p?.loja ?? "")) return false;
  if (ignorar !== "faixa" && f.faixas.length && !f.faixas.includes(p?.faixa ?? "Sem compra")) return false;
  if (f.semComprarDias && (!p?.ultima || p.ultima > somarDias(hoje, -f.semComprarDias))) return false;
  if (f.compraramDias && (!p?.ultima || p.ultima <= somarDias(hoje, -f.compraramDias))) return false;
  if (f.gastoMinimo && (p?.total ?? 0) < f.gastoMinimo) return false;
  if (f.aniversariantes && c.nascimento?.slice(5, 7) !== hoje.slice(5, 7)) return false;
  if (f.comSaldo && saldo(c.id) <= 0) return false;
  return true;
}

/** Saldo de cashback de todas de uma vez (agrupando os movimentos antes). */
function saldos(base: BaseCrm, hoje: string): (id: string) => number {
  let mapa: Map<string, number> | null = null;
  return (id) => {
    if (!mapa) {
      mapa = new Map();
      const grupos = new Map<string, BaseCrm["cashback"]>();
      for (const m of base.cashback) (grupos.get(m.clienteId) ?? grupos.set(m.clienteId, []).get(m.clienteId)!).push(m);
      for (const [cid, movs] of grupos) mapa.set(cid, saldoDe({ ...base, cashback: movs }, cid, hoje));
    }
    return mapa.get(id) ?? 0;
  };
}

/** Quem recebe, já com as regras de envio aplicadas, das que mais gastaram para as que menos. */
function selecionar(base: BaseCrm, f: FiltroCampanha) {
  const hoje = hojeSp();
  const prf = perfis(base, hoje);
  const saldo = saldos(base, hoje);
  const faixas = { Ouro: 0, Prata: 0, Bronze: 0, Nova: 0, Parada: 0, "Sem compra": 0 } as Record<FaixaCliente, number>;
  const lojas: Record<string, number> = {};
  const alvo: { c: Cliente; p: Perfil }[] = [];
  for (const c of base.clientes) {
    const p = prf.get(c.id)!;
    if (noFiltro(c, p, f, hoje, saldo, "faixa")) faixas[p.faixa]++;
    if (noFiltro(c, p, f, hoje, saldo, "loja")) lojas[p.loja ?? ""] = (lojas[p.loja ?? ""] ?? 0) + 1;
    if (noFiltro(c, p, f, hoje, saldo)) alvo.push({ c, p });
  }
  alvo.sort((a, b) => b.p.total - a.p.total);
  const puladas: Record<string, number> = {};
  const semNumero: Record<string, number> = {};
  const podem: { c: Cliente; p: Perfil; loja: string }[] = [];
  for (const x of alvo) {
    const motivo = motivoBloqueio(base, x.c, "avulsa");
    if (motivo) {
      puladas[motivo] = (puladas[motivo] ?? 0) + 1;
      continue;
    }
    const loja = lojaDeEnvio(base, x.p.loja);
    if (!loja) {
      if (x.p.loja && x.p.loja !== "Site") semNumero[x.p.loja] = (semNumero[x.p.loja] ?? 0) + 1;
      else puladas["nenhum número de WhatsApp ligado"] = (puladas["nenhum número de WhatsApp ligado"] ?? 0) + 1;
      continue;
    }
    podem.push({ ...x, loja });
  }
  const limite = f.limite && f.limite > 0 ? f.limite : Infinity;
  const ok = podem.slice(0, limite);
  const fora: Previa["fora"] = Object.entries(puladas).map(([motivo, n]) => ({ motivo, n }));
  const nSem = Object.values(semNumero).reduce((a, b) => a + b, 0);
  if (nSem) fora.push({ motivo: "loja ainda sem WhatsApp no CRM", n: nSem, detalhe: Object.entries(semNumero).map(([loja, n]) => ({ loja, n })).sort((a, b) => b.n - a.n) });
  fora.sort((a, b) => b.n - a.n);
  return { alvo, podem, ok, puladas: { ...puladas, ...Object.fromEntries(Object.entries(semNumero).map(([l, n]) => [`loja ${l} ainda sem número`, n])) }, fora, faixas, lojas, hoje };
}

/** Variáveis de uma cliente: vendedora da loja, saldo de cashback e quando vence. */
function variaveisDe(base: BaseCrm, c: Cliente, loja: string, hoje: string) {
  const saldo = saldoDe(base, c.id, hoje);
  const venc = creditosAbertos(base, c.id).sort((a, b) => a.validade.localeCompare(b.validade))[0]?.validade;
  return { vendedora: assinatura(base, loja), valor: saldo > 0 ? saldo : undefined, validade: saldo > 0 ? venc : undefined, compraMinima: saldo > 0 ? compraMinimaPara(base, saldo) : undefined };
}

export function previa(base: BaseCrm, f: FiltroCampanha, variacoes: string[] = [], oferta?: string): Previa {
  const { alvo, podem, ok, fora, faixas, lojas, hoje } = selecionar(base, f);
  const porLoja = new Map<string, number>();
  for (const x of ok) porLoja.set(x.loja, (porLoja.get(x.loja) ?? 0) + 1);
  const textos = variacoes.map((t) => t.trim()).filter(Boolean);
  const maior = Math.max(0, ...porLoja.values());
  return {
    noFiltro: alvo.length,
    podem: podem.length,
    recebem: ok.length,
    fora,
    porLoja: Array.from(porLoja, ([loja, n]) => {
      const num = base.config.numeros.find((x) => x.loja === loja);
      return {
        loja,
        n,
        teto: tetoDoNumero(base.config, num, hojeSp()),
        jaHoje: enviadasHoje(base, loja, hoje),
        naFila: base.mensagens.filter((m) => m.loja === loja && m.status === "fila" && m.naoAntesDe.startsWith(hoje)).length,
      };
    }),
    faixas,
    lojas,
    amostra: ok.slice(0, 8).map(({ c, p }) => ({ nome: c.nome, faixa: p.faixa, total: p.total, compras: p.compras, ultima: p.ultima, loja: p.loja })),
    exemplos: textos.length
      ? ok.slice(0, 6).map((x, i) => {
          const ref = x.p.loja ?? x.loja;
          return { nome: x.c.nome, loja: ref, texto: renderizar(textos[i % textos.length], x.c, ref, { ...variaveisDe(base, x.c, ref, hoje), oferta, codigo: oferta ? "AB12CD" : undefined }) };
        })
      : [],
    minimoMin: Math.ceil((maior * base.config.intervaloMinSeg) / 60),
    modoSombra: base.config.modoSombra,
  };
}

export interface PedidoCampanha {
  nome: string;
  filtro: FiltroCampanha;
  variacoes: string[];
  oferta?: string;
  /** ISO; vazio = agora */
  inicio?: string;
  duracaoMin: number;
}

/**
 * Cria a campanha e põe as mensagens na fila, cada uma com seu horário:
 * por número, espalhadas por igual na duração escolhida, com uma folga
 * aleatória pra não ficar um relógio.
 */
export function criarCampanha(base: BaseCrm, p: PedidoCampanha): CampanhaManual {
  const variacoes = p.variacoes.map((t) => t.trim()).filter(Boolean);
  if (!variacoes.length) throw new Error("Escreva o texto da mensagem.");
  if (!p.nome.trim()) throw new Error("Dê um nome pra campanha.");
  const duracao = Math.min(12 * 60, Math.max(10, Math.round(p.duracaoMin || 60)));
  const inicio = p.inicio ? new Date(p.inicio) : new Date();
  if (Number.isNaN(inicio.getTime())) throw new Error("Horário de início inválido.");
  const oferta = p.oferta?.trim() || undefined;
  if (oferta && !variacoes.every((v) => v.includes("{codigo}"))) throw new Error("Com oferta, todo texto precisa ter {codigo}: é ele que a cliente mostra no caixa.");

  const { ok, puladas, hoje } = selecionar(base, p.filtro);
  if (!ok.length) {
    const motivos = Object.entries(puladas).map(([k, v]) => `${v} ${k}`).join(", ");
    throw new Error(`Ninguém pra receber com esse filtro${motivos ? ` (${motivos})` : ""}.`);
  }
  const id = novoId();
  const camp: CampanhaManual = {
    id,
    nome: p.nome.trim(),
    criadaEm: new Date().toISOString(),
    filtro: p.filtro,
    variacoes,
    oferta,
    inicio: inicio.toISOString(),
    duracaoMin: duracao,
    total: 0,
    puladas,
    simulada: base.config.modoSombra || undefined,
  };

  const grupos = new Map<string, typeof ok>();
  for (const x of ok) (grupos.get(x.loja) ?? grupos.set(x.loja, []).get(x.loja)!).push(x);
  for (const [loja, lista] of grupos) {
    const passo = (duracao * 60000) / lista.length;
    lista.forEach((x, i) => {
      const folga = (Math.random() - 0.5) * passo * 0.6;
      const quando = new Date(inicio.getTime() + i * passo + (i === 0 ? Math.random() * passo * 0.3 : folga));
      const ref = x.p.loja ?? loja;
      const r = enfileirar(base, {
        cliente: x.c,
        campanha: "avulsa",
        loja: ref,
        texto: variacoes[Math.floor(Math.random() * variacoes.length)],
        variaveis: { ...variaveisDe(base, x.c, ref, hoje), oferta },
        oferta,
        chave: `camp-${id}-${x.c.id}`,
        naoAntesDe: quando.toISOString(),
        campanhaId: id,
      });
      if (r.mensagem) camp.total++;
      else camp.puladas[r.motivo ?? "?"] = (camp.puladas[r.motivo ?? "?"] ?? 0) + 1;
    });
  }
  base.campanhas.push(camp);
  return camp;
}

export function cancelarCampanha(base: BaseCrm, id: string): number {
  const c = base.campanhas.find((x) => x.id === id);
  if (!c) throw new Error("Campanha não encontrada.");
  let n = 0;
  for (const m of base.mensagens) {
    if (m.campanhaId === id && (m.status === "fila" || m.status === "simulada")) {
      m.status = "cancelada";
      n++;
    }
  }
  c.canceladaEm = new Date().toISOString();
  return n;
}

/** O que um conjunto de mensagens rendeu: entrega, leitura, resposta, SAIR, código usado, compra em 14 dias. */
function resultado(base: BaseCrm, msgs: Mensagem[], vendasDe: Map<string, { data: string; valor: number }[]>) {
  const r = { total: msgs.length, fila: 0, simuladas: 0, enviadas: 0, entregues: 0, lidas: 0, respondidas: 0, erros: 0, canceladas: 0, sair: 0, codigosUsados: 0, compraram: 0, receita: 0, proxima: undefined as string | undefined, ultima: undefined as string | undefined };
  const optOut = new Map(base.clientes.filter((c) => c.optOutEm).map((c) => [c.id, c.optOutEm!]));
  const codigos = new Map(base.codigos.filter((k) => k.mensagemId && k.usadoEm).map((k) => [k.mensagemId!, k]));
  for (const m of msgs) {
    if (m.status === "fila" || m.status === "enviando") {
      r.fila++;
      if (!r.proxima || m.naoAntesDe < r.proxima) r.proxima = m.naoAntesDe;
      if (!r.ultima || m.naoAntesDe > r.ultima) r.ultima = m.naoAntesDe;
    } else if (m.status === "simulada") r.simuladas++;
    else if (m.status === "erro") r.erros++;
    else if (m.status === "cancelada") r.canceladas++;
    if (!m.enviadoEm) continue;
    r.enviadas++;
    if (["entregue", "lida", "respondida"].includes(m.status)) r.entregues++;
    if (["lida", "respondida"].includes(m.status)) r.lidas++;
    if (m.status === "respondida") r.respondidas++;
    const sai = optOut.get(m.clienteId);
    if (sai && sai >= m.enviadoEm && sai <= new Date(new Date(m.enviadoEm).getTime() + 7 * 86400000).toISOString()) r.sair++;
    if (codigos.has(m.id)) r.codigosUsados++;
    const limite = new Date(new Date(m.enviadoEm).getTime() + 14 * 86400000).toISOString();
    const compras = (vendasDe.get(m.clienteId) ?? []).filter((v) => v.data > m.enviadoEm! && v.data <= limite);
    if (compras.length) {
      r.compraram++;
      r.receita += compras.reduce((s, v) => s + v.valor, 0);
    }
  }
  r.receita = Math.round(r.receita * 100) / 100;
  return r;
}

export type ResultadoCampanha = ReturnType<typeof resultado>;

export function listarCampanhas(base: BaseCrm) {
  const vendasDe = new Map<string, { data: string; valor: number }[]>();
  for (const v of base.vendas) if (v.clienteId && v.valor > 0 && contaComoCompra(v)) (vendasDe.get(v.clienteId) ?? vendasDe.set(v.clienteId, []).get(v.clienteId)!).push({ data: v.data, valor: valorLiquido(v) });
  const porCampanha = new Map<string, Mensagem[]>();
  const porTipo = new Map<string, Mensagem[]>();
  const desde30 = new Date(Date.now() - 30 * 86400000).toISOString();
  for (const m of base.mensagens) {
    if (m.campanhaId) (porCampanha.get(m.campanhaId) ?? porCampanha.set(m.campanhaId, []).get(m.campanhaId)!).push(m);
    else if (m.campanha !== "avulsa" && m.criadoEm >= desde30) (porTipo.get(m.campanha) ?? porTipo.set(m.campanha, []).get(m.campanha)!).push(m);
  }
  const manuais = [...base.campanhas]
    .sort((a, b) => b.criadaEm.localeCompare(a.criadaEm))
    .map((c) => ({ ...c, resultado: resultado(base, porCampanha.get(c.id) ?? [], vendasDe) }));
  const automaticas = CAMPANHAS.filter((c) => c.id !== "avulsa").map((c) => ({
    id: c.id,
    nome: c.nome,
    dica: c.dica,
    ativa: base.modelos.find((m) => m.campanha === c.id)?.ativo ?? false,
    resultado: resultado(base, porTipo.get(c.id) ?? [], vendasDe),
  }));
  return { manuais, automaticas, modoSombra: base.config.modoSombra, envioInicio: base.config.envioInicio, envioFim: base.config.envioFim, envioDias: base.config.envioDias, intervaloMinSeg: base.config.intervaloMinSeg };
}
