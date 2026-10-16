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

/** Só conta espera dentro do horário de atendimento (SP). */
function minutosUteis(de: Date, ate: Date, inicio: number, fim: number): number {
  if (ate <= de) return 0;
  let total = 0;
  const cur = new Date(de);
  while (cur < ate) {
    const h = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", hour: "2-digit", hour12: false }).format(cur)) % 24;
    const dow = new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", weekday: "short" }).format(cur);
    if (dow !== "Sun" && h >= inicio && h < fim) total++;
    cur.setMinutes(cur.getMinutes() + 1);
    if (total > 7 * 24 * 60) break;
  }
  return total;
}

export function resumoAtendimento(base: BaseCrm, dias = 7): { lojas: ResumoLoja[]; pendentes: Pendente[]; desde: string } {
  const agora = new Date();
  const desde = new Date(agora.getTime() - dias * 86400000).toISOString();
  const eventos = base.atendimento.filter((a) => a.em >= desde).sort((a, b) => a.em.localeCompare(b.em));
  const cfg = base.config;
  const inicio = cfg.envioInicio;
  const fim = cfg.envioFim;
  const nomes = new Map(base.clientes.filter((c) => c.telefone).map((c) => [c.telefone!, c.nome]));

  const porLoja = new Map<string, { conversas: Set<string>; msgs: number; respondidas: number; tempos: number[]; lentas: number }>();
  // Por conversa: última mensagem da cliente ainda sem resposta
  const aberta = new Map<string, { em: string; texto?: string; loja: string }>();

  for (const ev of eventos) {
    const chave = `${ev.loja}|${ev.telefone}`;
    const l = porLoja.get(ev.loja) ?? porLoja.set(ev.loja, { conversas: new Set(), msgs: 0, respondidas: 0, tempos: [], lentas: 0 }).get(ev.loja)!;
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
    pendentes: pendentes.filter((p) => p.loja === loja).length,
  })).sort((a, b) => b.conversas - a.conversas);

  // Lojas com número ativo mas sem nenhuma conversa aparecem zeradas
  for (const n of cfg.numeros.filter((x) => x.ativo)) {
    if (!lojas.some((l) => l.loja === n.loja)) lojas.push({ loja: n.loja, conversas: 0, mensagensClientes: 0, respondidas: 0, medianaMin: null, lentas: 0, pendentes: 0 });
  }
  return { lojas, pendentes: pendentes.slice(0, 100), desde: desde.slice(0, 10) };
}
