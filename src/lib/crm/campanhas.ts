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
import { CAMPANHAS, type BaseCrm, type CampanhaManual, type Cliente, type FaixaCliente, type FiltroCampanha, type Mensagem } from "./tipos";

export interface Previa {
  /** Clientes no filtro (antes das regras de envio) */
  noFiltro: number;
  /** Quantas vão receber */
  recebem: number;
  puladas: Record<string, number>;
  /** Por número que vai mandar */
  porLoja: { loja: string; n: number; teto: number; jaHoje: number; naFila: number }[];
  /** Contagem por faixa, só com o filtro de loja aplicado (pra escolher a faixa) */
  faixas: Record<FaixaCliente, number>;
  amostra: { nome: string; faixa: FaixaCliente; total: number; compras: number; ultima?: string; loja?: string }[];
  /** Texto de exemplo, renderizado para a primeira cliente */
  exemplo?: string;
  /** Minutos que leva no mínimo, pelo intervalo mínimo entre mensagens do mesmo número */
  minimoMin: number;
  modoSombra: boolean;
}

function noFiltro(base: BaseCrm, c: Cliente, p: Perfil | undefined, f: FiltroCampanha, hoje: string, comFaixa = true): boolean {
  if (f.lojas.length && !f.lojas.includes(p?.loja ?? "")) return false;
  if (comFaixa && f.faixas.length && !f.faixas.includes(p?.faixa ?? "Sem compra")) return false;
  if (f.semComprarDias && (!p?.ultima || p.ultima > somarDias(hoje, -f.semComprarDias))) return false;
  if (f.compraramDias && (!p?.ultima || p.ultima <= somarDias(hoje, -f.compraramDias))) return false;
  if (f.gastoMinimo && (p?.total ?? 0) < f.gastoMinimo) return false;
  if (f.aniversariantes && c.nascimento?.slice(5, 7) !== hoje.slice(5, 7)) return false;
  if (f.comSaldo && saldoDe(base, c.id, hoje) <= 0) return false;
  return true;
}

/** Quem recebe, já com as regras de envio aplicadas, das que mais gastaram para as que menos. */
function selecionar(base: BaseCrm, f: FiltroCampanha) {
  const hoje = hojeSp();
  const prf = perfis(base, hoje);
  const faixas = { Ouro: 0, Prata: 0, Bronze: 0, Nova: 0, Parada: 0, "Sem compra": 0 } as Record<FaixaCliente, number>;
  const alvo: { c: Cliente; p: Perfil }[] = [];
  for (const c of base.clientes) {
    const p = prf.get(c.id)!;
    if (!noFiltro(base, c, p, f, hoje, false)) continue;
    faixas[p.faixa]++;
    if (f.faixas.length && !f.faixas.includes(p.faixa)) continue;
    alvo.push({ c, p });
  }
  alvo.sort((a, b) => b.p.total - a.p.total);
  const puladas: Record<string, number> = {};
  const ok: { c: Cliente; p: Perfil; loja: string }[] = [];
  const limite = f.limite && f.limite > 0 ? f.limite : Infinity;
  for (const x of alvo) {
    if (ok.length >= limite) {
      puladas["acima do limite de clientes"] = (puladas["acima do limite de clientes"] ?? 0) + 1;
      continue;
    }
    let motivo = motivoBloqueio(base, x.c, "avulsa");
    const loja = motivo ? undefined : lojaDeEnvio(base, x.p.loja);
    if (!motivo && !loja) motivo = x.p.loja && x.p.loja !== "Site" ? `loja ${x.p.loja} ainda sem número` : "nenhum número de WhatsApp configurado";
    if (motivo) puladas[motivo] = (puladas[motivo] ?? 0) + 1;
    else ok.push({ ...x, loja: loja! });
  }
  return { alvo, ok, puladas, faixas, hoje };
}

/** Variáveis de uma cliente: vendedora da loja, saldo de cashback e quando vence. */
function variaveisDe(base: BaseCrm, c: Cliente, loja: string, hoje: string) {
  const saldo = saldoDe(base, c.id, hoje);
  const venc = creditosAbertos(base, c.id).sort((a, b) => a.validade.localeCompare(b.validade))[0]?.validade;
  return { vendedora: assinatura(base, loja), valor: saldo > 0 ? saldo : undefined, validade: saldo > 0 ? venc : undefined, compraMinima: saldo > 0 ? compraMinimaPara(base, saldo) : undefined };
}

export function previa(base: BaseCrm, f: FiltroCampanha, variacoes: string[] = [], oferta?: string): Previa {
  const { alvo, ok, puladas, faixas, hoje } = selecionar(base, f);
  const porLoja = new Map<string, number>();
  for (const x of ok) porLoja.set(x.loja, (porLoja.get(x.loja) ?? 0) + 1);
  const primeira = ok[0];
  const texto = variacoes.map((t) => t.trim()).find(Boolean);
  const maior = Math.max(0, ...porLoja.values());
  return {
    noFiltro: alvo.length,
    recebem: ok.length,
    puladas,
    porLoja: Array.from(porLoja, ([loja, n]) => {
      const num = base.config.numeros.find((x) => x.loja === loja);
      return {
        loja,
        n,
        teto: num?.tetoDia ?? base.config.tetoDiaPorNumero,
        jaHoje: enviadasHoje(base, loja, hoje),
        naFila: base.mensagens.filter((m) => m.loja === loja && m.status === "fila" && m.naoAntesDe.startsWith(hoje)).length,
      };
    }),
    faixas,
    amostra: ok.slice(0, 8).map(({ c, p }) => ({ nome: c.nome, faixa: p.faixa, total: p.total, compras: p.compras, ultima: p.ultima, loja: p.loja })),
    exemplo:
      primeira && texto
        ? renderizar(texto, primeira.c, primeira.p.loja ?? primeira.loja, { ...variaveisDe(base, primeira.c, primeira.p.loja ?? primeira.loja, hoje), oferta, codigo: oferta ? "AB12CD" : undefined })
        : undefined,
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
  for (const v of base.vendas) if (v.clienteId && v.valor > 0) (vendasDe.get(v.clienteId) ?? vendasDe.set(v.clienteId, []).get(v.clienteId)!).push({ data: v.data, valor: v.valor });
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
