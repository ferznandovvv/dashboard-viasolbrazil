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
  /** Nome no WhatsApp (contato salvo no celular da loja ou o que ela usa), quando não está na base */
  apelido?: string;
  /** Minutos esperando */
  esperando: number;
  desde: string;
  texto?: string;
  /** Última mensagem dela (para "não precisa responder") */
  ultima: string;
}

/** Horário de um dia: [abre, fecha] em minutos desde a meia-noite, ou null se fechado. */
export type Janela = (diaSemana: number) => [number, number] | null;

/** "10:00-22:00" ou "10-22" vira [600, 1320]; vazio ou inválido vira null (fechado). */
export function lerFaixa(t?: string): [number, number] | null {
  const m = (t ?? "").trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(?:-|às|a|até)\s*(\d{1,2})(?::(\d{2}))?$/i);
  if (!m) return null;
  const ini = Number(m[1]) * 60 + Number(m[2] ?? 0);
  const fim = Number(m[3]) * 60 + Number(m[4] ?? 0);
  return fim > ini && fim <= 24 * 60 ? [ini, fim] : null;
}

/**
 * Horário de atendimento da loja: o que estiver cadastrado em Números, senão
 * o horário de envio de segunda a sábado (domingo fechado).
 */
export function janelaDaLoja(base: BaseCrm, loja: string): Janela {
  const h = base.config.numeros.find((n) => n.loja === loja)?.horario;
  const padrao: [number, number] = [base.config.envioInicio * 60, base.config.envioFim * 60];
  if (!h) return (dia) => (dia === 0 ? null : padrao);
  return (dia) => (dia === 0 ? lerFaixa(h.domingo) : dia === 6 ? lerFaixa(h.sabado) : lerFaixa(h.semana));
}

/**
 * Minutos de espera dentro do horário de atendimento da loja (relógio de SP).
 * Brasil não tem horário de verão desde 2019: SP é UTC-3 fixo, então dá pra
 * fazer a conta direto, sem formatar data minuto a minuto.
 */
export function minutosUteis(de: Date, ate: Date, janela: Janela): number {
  if (ate <= de) return 0;
  const OFF = 3 * 3600000;
  const MIN = 60000;
  const DIA = 86400000;
  let t = Math.floor((de.getTime() - OFF) / MIN) * MIN; // relógio de SP, em ms "UTC"
  const final = ate.getTime() - OFF;
  let total = 0;
  for (let voltas = 0; t < final && voltas < 120; voltas++) {
    const d = new Date(t);
    const meiaNoite = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    const j = janela(d.getUTCDay());
    if (j) {
      const abre = meiaNoite + j[0] * MIN;
      const fecha = meiaNoite + j[1] * MIN;
      const ini = Math.max(t, abre);
      const fim = Math.min(final, fecha);
      if (fim > ini) total += Math.round((fim - ini) / MIN);
    }
    t = meiaNoite + DIA;
  }
  return total;
}

/**
 * Mensagem da cliente que encerra a conversa e não pede resposta ("obrigada ✅",
 * "ok, tudo bem 🥰", "👍", figurinha). Cumprimento ("bom dia") e pergunta (com
 * "?") nunca encerram: pedem resposta.
 */
const lista = (t: string) => new Set(t.split(" "));
/** Palavras que encerram de fato */
const FIM = lista(
  "ok okay okey oks ta tah to beleza blz show combinado perfeito perfeita otimo otima massa valeu vlw obrigada obrigado " +
    "obrigadas obrigados obg obgd brigada brigado brigadu agradeco grata grato nada imagina tchau ate entendi entendido certo " +
    "certinho top amei maravilha bem joia fechado fechou igualmente bjs bjo bjos beijos beijo abraco abracos tmj ja"
);
/** Palavras que só acompanham ("obrigada, linda, boa noite"); sozinhas não encerram */
const ACOMPANHA = lista(
  "bom boa muito muita mto mt mta demais de mais logo amanha breve noite dia tarde tudo ah ahh e a pela pelo atencao ajuda " +
    "carinho viu entao flor querida querido linda lindo amiga amigo semana fds feliz otimos deus abencoe kk kkk rs pra voce vc voces"
);
const SO_EMOJI = /^[\p{Extended_Pictographic}\p{Emoji_Component}\s]+$/u;

export function encerraConversa(texto?: string): boolean {
  const t = (texto ?? "").trim();
  if (!t) return false;
  if (/^\[(sticker|stickermessage|reaction|reactionmessage)\]$/i.test(t)) return true;
  if (t.includes("?")) return false;
  if (SO_EMOJI.test(t)) return true;
  const palavras = t
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\p{Extended_Pictographic}\p{Emoji_Component}]/gu, " ")
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    // "obrigadaaa", "okkk", "blzz": letra repetida no fim conta como uma
    .map((w) => w.replace(/(.)\1+$/, "$1"));
  if (!palavras.length || palavras.length > 8) return false;
  const tem = (c: Set<string>, w: string) => c.has(w) || c.has(w.replace(/s$/, ""));
  return palavras.every((w) => tem(FIM, w) || tem(ACOMPANHA, w)) && palavras.some((w) => tem(FIM, w));
}

/** Rótulo de mensagem sem texto (foto, áudio...) para mostrar na tela. */
export function rotuloMensagem(texto?: string): string {
  const t = (texto ?? "").trim();
  const m = /^\[([a-z_]+?)(message)?\]$/i.exec(t);
  if (!t) return "mensagem sem texto (foto, áudio ou figurinha)";
  if (!m) return t;
  const r: Record<string, string> = { image: "📷 Foto", audio: "🎤 Áudio", video: "🎬 Vídeo", document: "📄 Documento", sticker: "Figurinha", location: "📍 Localização", contact: "👤 Contato", ptt: "🎤 Áudio" };
  return r[m[1].toLowerCase()] ?? "Mensagem sem texto";
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
  const janelas = new Map<string, Janela>();
  const janela = (loja: string) => janelas.get(loja) ?? janelas.set(loja, janelaDaLoja(base, loja)).get(loja)!;
  const nomes = new Map(base.clientes.filter((c) => c.telefone).map((c) => [c.telefone!, c.nome]));
  // Mensagem automática do WhatsApp Business (ausência, saudação): o mesmo
  // texto mandado pela loja para 5+ conversas não conta como resposta
  const repeticoes = new Map<string, Set<string>>();
  for (const ev of eventos) {
    if (ev.de !== "loja" || !ev.texto || ev.texto.length < 20) continue;
    const k = `${ev.loja}|${ev.texto}`;
    (repeticoes.get(k) ?? repeticoes.set(k, new Set()).get(k)!).add(ev.telefone);
  }
  const automatica = (ev: { loja: string; texto?: string }) => Boolean(ev.texto && (repeticoes.get(`${ev.loja}|${ev.texto}`)?.size ?? 0) >= 5);

  const porLoja = new Map<string, { conversas: Set<string>; msgs: number; respondidas: number; tempos: number[]; lentas: number; rapidas: number }>();
  // Por conversa: última mensagem da cliente ainda sem resposta
  const aberta = new Map<string, { em: string; ultima: string; texto?: string; loja: string }>();
  const ignorados = base.atendimentoIgnorado ?? {};
  // Nome do WhatsApp de quem não está na base (o último que veio)
  const apelido = new Map<string, string>();
  for (const a of base.atendimento) if (a.de === "cliente" && a.nome) apelido.set(a.telefone, a.nome);

  for (const ev of eventos) {
    const chave = `${ev.loja}|${ev.telefone}`;
    const l = porLoja.get(ev.loja) ?? porLoja.set(ev.loja, { conversas: new Set(), msgs: 0, respondidas: 0, tempos: [], lentas: 0, rapidas: 0 }).get(ev.loja)!;
    if (ev.de === "cliente") {
      l.conversas.add(ev.telefone);
      l.msgs++;
      // Uma sequência de mensagens da cliente conta como uma espera só, a partir da primeira;
      // "obrigada!" e figurinha não abrem espera
      if (!aberta.has(chave)) {
        // Ninguém abre conversa com "obrigada": muitas vezes a conversa começou antes do painel ver
        if (!encerraConversa(ev.texto)) aberta.set(chave, { em: ev.em, ultima: ev.em, texto: ev.texto, loja: ev.loja });
      } else {
        const a = aberta.get(chave)!;
        a.ultima = ev.em;
        // Mantém a pergunta: um "obrigada" depois dela não esconde o que ela perguntou
        if (!encerraConversa(ev.texto)) a.texto = ev.texto ?? a.texto;
      }
    } else {
      if (automatica(ev)) continue;
      const a = aberta.get(chave);
      if (a) {
        const min = minutosUteis(new Date(a.em), new Date(ev.em), janela(ev.loja));
        l.respondidas++;
        l.tempos.push(min);
        if (min > 60) l.lentas++;
        if (min <= 15) l.rapidas++;
        aberta.delete(chave);
      }
    }
  }

  const pendentes: Pendente[] = [];
  // Só cobra resposta de loja com WhatsApp ligado agora (número de teste apagado não fica "esperando" pra sempre)
  const ligadas = new Set(base.config.numeros.filter((n) => n.ativo && n.sessao).map((n) => n.loja));
  for (const [chave, a] of aberta) {
    if (!ligadas.has(a.loja)) continue;
    // Alguém marcou "não precisa responder" depois da última mensagem dela
    if (ignorados[chave] && ignorados[chave] >= a.ultima) continue;
    const telefone = chave.split("|")[1];
    const esperando = minutosUteis(new Date(a.em), agora, janela(a.loja));
    if (esperando < 15) continue; // ainda é normal
    pendentes.push({ loja: a.loja, telefone, cliente: nomes.get(telefone), apelido: apelido.get(telefone), esperando, desde: a.em, texto: rotuloMensagem(a.texto), ultima: a.ultima });
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
