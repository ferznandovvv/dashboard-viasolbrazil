/**
 * Como as lojas estão atendendo o WhatsApp: a partir das mensagens que
 * entram e saem pelo gateway (digitadas no celular ou pela API), mede
 * tempo de resposta por loja e lista quem está esperando.
 */

import type { BaseCrm } from "./tipos";

export interface ResumoLoja {
  loja: string;
  /** Telefones distintos que escreveram no período */
  conversas: number;
  mensagensClientes: number;
  /** Mensagens de cliente que receberam resposta da loja depois */
  respondidas: number;
  /** Mediana, em minutos, da primeira resposta da loja a uma mensagem de cliente */
  medianaMin: number | null;
  /** Respostas que levaram mais de 1h */
  lentas: number;
  /** Respostas em até 15 min de expediente */
  rapidas: number;
  pendentes: number;
}

export interface Pendente {
  loja: string;
  telefone: string;
  cliente?: string;
  /** Minutos esperando */
  esperando: number;
  desde: string;
  texto?: string;
}

/**
 * Minutos de espera dentro do horário de atendimento (SP, sem domingo).
 * Brasil não tem horário de verão desde 2019: SP é UTC-3 fixo, então dá pra
 * fazer a conta direto, sem formatar data minuto a minuto.
 */
export function minutosUteis(de: Date, ate: Date, inicio: number, fim: number): number {
  if (ate <= de) return 0;
  const OFF = 3 * 3600000;
  const MIN = 60000;
  let t = Math.floor((de.getTime() - OFF) / MIN) * MIN; // relógio de SP, em ms "UTC"
  const final = ate.getTime() - OFF;
  let total = 0;
  while (t < final) {
    const d = new Date(t);
    const h = d.getUTCHours();
    const diaUtil = d.getUTCDay() !== 0;
    if (diaUtil && h >= inicio && h < fim) {
      // Dentro do expediente: anda até o fim do expediente ou até `final`
      const fimExp = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), fim);
      const ate2 = Math.min(fimExp, final);
      total += Math.max(0, Math.round((ate2 - t) / MIN));
      t = ate2;
    } else {
      // Fora: pula para o próximo início de expediente
      const base = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), inicio);
      t = h < inicio && diaUtil ? base : base + 86400000;
    }
    if (total > 45 * 24 * 60) break;
  }
  return total;
}

export interface ResumoAtendimento {
  lojas: ResumoLoja[];
  pendentes: Pendente[];
  desde: string;
  /** Todas as lojas juntas */
  medianaMin: number | null;
  respondidas: number;
  rapidas: number;
}

/** `desdeIso` sobrepõe `dias` (ex.: meia-noite de hoje). */
export function resumoAtendimento(base: BaseCrm, dias = 7, desdeIso?: string): ResumoAtendimento {
  const agora = new Date();
  const desde = desdeIso ?? new Date(agora.getTime() - dias * 86400000).toISOString();
  const eventos = base.atendimento.filter((a) => a.em >= desde).sort((a, b) => a.em.localeCompare(b.em));
  const cfg = base.config;
  const inicio = cfg.envioInicio;
  const fim = cfg.envioFim;
  const nomes = new Map(base.clientes.filter((c) => c.telefone).map((c) => [c.telefone!, c.nome]));

  const porLoja = new Map<string, { conversas: Set<string>; msgs: number; respondidas: number; tempos: number[]; lentas: number; rapidas: number }>();
  // Por conversa: última mensagem da cliente ainda sem resposta
  const aberta = new Map<string, { em: string; texto?: string; loja: string }>();

  for (const ev of eventos) {
    const chave = `${ev.loja}|${ev.telefone}`;
    const l = porLoja.get(ev.loja) ?? porLoja.set(ev.loja, { conversas: new Set(), msgs: 0, respondidas: 0, tempos: [], lentas: 0, rapidas: 0 }).get(ev.loja)!;
    if (ev.de === "cliente") {
      l.conversas.add(ev.telefone);
      l.msgs++;
      // Uma sequência de mensagens da cliente conta como uma espera só, a partir da primeira
      if (!aberta.has(chave)) aberta.set(chave, { em: ev.em, texto: ev.texto, loja: ev.loja });
      else aberta.get(chave)!.texto = ev.texto ?? aberta.get(chave)!.texto;
    } else {
      const a = aberta.get(chave);
      if (a) {
        const min = minutosUteis(new Date(a.em), new Date(ev.em), inicio, fim);
        l.respondidas++;
        l.tempos.push(min);
        if (min > 60) l.lentas++;
        if (min <= 15) l.rapidas++;
        aberta.delete(chave);
      }
    }
  }

  const pendentes: Pendente[] = [];
  for (const [chave, a] of aberta) {
    const telefone = chave.split("|")[1];
    const esperando = minutosUteis(new Date(a.em), agora, inicio, fim);
    if (esperando < 15) continue; // ainda é normal
    pendentes.push({ loja: a.loja, telefone, cliente: nomes.get(telefone), esperando, desde: a.em, texto: a.texto });
  }
  pendentes.sort((x, y) => y.esperando - x.esperando);

  const mediana = (v: number[]) => {
    if (!v.length) return null;
    const s = [...v].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  };
  const lojas: ResumoLoja[] = Array.from(porLoja, ([loja, l]) => ({
    loja,
    conversas: l.conversas.size,
    mensagensClientes: l.msgs,
    respondidas: l.respondidas,
    medianaMin: mediana(l.tempos),
    lentas: l.lentas,
    rapidas: l.rapidas,
    pendentes: pendentes.filter((p) => p.loja === loja).length,
  })).sort((a, b) => b.conversas - a.conversas);

  // Lojas com número ativo mas sem nenhuma conversa aparecem zeradas
  for (const n of cfg.numeros.filter((x) => x.ativo)) {
    if (!lojas.some((l) => l.loja === n.loja)) lojas.push({ loja: n.loja, conversas: 0, mensagensClientes: 0, respondidas: 0, medianaMin: null, lentas: 0, rapidas: 0, pendentes: 0 });
  }
  const todos = Array.from(porLoja.values()).flatMap((l) => l.tempos);
  return {
    lojas,
    pendentes: pendentes.slice(0, 100),
    desde: desde.slice(0, 10),
    medianaMin: mediana(todos),
    respondidas: todos.length,
    rapidas: todos.filter((t) => t <= 15).length,
  };
}
