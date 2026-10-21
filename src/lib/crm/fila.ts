/**
 * A fila de envio: tira uma mensagem por vez de cada número, respeitando
 * horário comercial, teto diário por número e intervalo aleatório entre
 * mensagens. É isso que protege os números, não o provedor.
 *
 * Roda a cada 20 segundos pelo agendador quando o sistema está na máquina.
 */

import { adaptadorDe } from "./envio/adaptador";
import { CloudApi } from "./envio/cloudApi";
import { alterarBase, hojeSp, lerBase } from "./base";
import { CAMPANHAS_SITE, LOJA_OFICIAL, oficialDe, tetoDoNumero, type Atendimento, type BaseCrm, type Mensagem } from "./tipos";

/** Quando cada número pode mandar de novo (ms). Em memória: reiniciar zera, e tudo bem. */
const proximoEnvio = new Map<string, number>();
let processando = false;

function agoraSp(): { dia: number; hora: number; minuto: number } {
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const v = (t: string) => partes.find((p) => p.type === t)?.value ?? "";
  const dias: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { dia: dias[v("weekday")] ?? 0, hora: Number(v("hour")) % 24, minuto: Number(v("minute")) };
}

/** Está dentro da janela de envio configurada? */
export function dentroDaJanela(base: BaseCrm): boolean {
  const { dia, hora } = agoraSp();
  const cfg = base.config;
  return cfg.envioDias.includes(dia) && hora >= cfg.envioInicio && hora < cfg.envioFim;
}

/** Mensagens que já saíram hoje por aquele número. */
export function enviadasHoje(base: BaseCrm, loja: string, hoje = hojeSp()): number {
  return base.mensagens.filter(
    (m) => m.loja === loja && m.enviadoEm?.startsWith(hoje) && ["enviada", "entregue", "lida", "respondida"].includes(m.status)
  ).length;
}

const aleatorio = (min: number, max: number) => min + Math.random() * (max - min);

export interface ResultadoTick {
  enviadas: number;
  erros: number;
  motivo?: string;
}

/**
 * Um passo da fila. Para cada número ativo que pode mandar agora, envia a
 * mensagem mais antiga em espera. Chamado pelo agendador e pelo botão
 * "processar agora" da tela.
 */
export async function processarFila(ignorarJanela = false): Promise<ResultadoTick> {
  if (processando) return { enviadas: 0, erros: 0, motivo: "já processando" };
  processando = true;
  try {
    const base = await lerBase();
    const cfg = base.config;
    if (cfg.pausado) return { enviadas: 0, erros: 0, motivo: "pausado" };
    if (cfg.modoSombra) return { enviadas: 0, erros: 0, motivo: "modo sombra: nada sai" };
    const adaptador = adaptadorDe(cfg);
    if (!adaptador) return { enviadas: 0, erros: 0, motivo: "sem provedor configurado" };
    // Carrinho e Pix do site têm horário próprio (todo dia, até mais tarde): a cliente acabou de estar no site
    const janelaLojas = ignorarJanela || dentroDaJanela(base);
    const janelaSite = ignorarJanela || dentroDaJanelaOficial(base);
    const podeAgora = (m: Mensagem) => (CAMPANHAS_SITE.includes(m.campanha) ? janelaSite : janelaLojas);
    if (!janelaLojas && !janelaSite) return { enviadas: 0, erros: 0, motivo: "fora do horário de envio" };

    const agora = Date.now();
    const agoraIso = new Date(agora).toISOString();
    const hoje = hojeSp();
    const escolhidas: Mensagem[] = [];

    for (const n of cfg.numeros.filter((x) => x.ativo && x.sessao)) {
      if ((proximoEnvio.get(n.loja) ?? 0) > agora) continue;
      if (enviadasHoje(base, n.loja, hoje) >= tetoDoNumero(cfg, n, hoje)) continue;
      const m = base.mensagens
        .filter((x) => x.loja === n.loja && x.provedor !== "oficial" && x.status === "fila" && x.naoAntesDe <= agoraIso && podeAgora(x))
        .sort((a, b) => a.naoAntesDe.localeCompare(b.naoAntesDe) || a.criadoEm.localeCompare(b.criadoEm))[0];
      if (m) escolhidas.push(m);
    }
    if (!escolhidas.length) return { enviadas: 0, erros: 0 };

    // Marca como "enviando" antes de chamar o provedor, para outro tick não pegar a mesma
    await alterarBase((b) => {
      for (const m of escolhidas) {
        const x = b.mensagens.find((y) => y.id === m.id);
        if (x) x.status = "enviando";
      }
    });

    let enviadas = 0;
    let erros = 0;
    const resultados = await Promise.all(
      escolhidas.map(async (m) => {
        const numero = cfg.numeros.find((n) => n.loja === m.loja)!;
        const r = await adaptador.enviarTexto(numero.sessao, m.telefone, m.texto);
        // Campanha já vem espaçada pelo horário de cada mensagem; aqui só garante o intervalo mínimo
        const espera = m.campanhaId ? cfg.intervaloMinSeg : aleatorio(cfg.intervaloMinSeg, cfg.intervaloMaxSeg);
        proximoEnvio.set(m.loja, Date.now() + espera * 1000);
        return { m, r };
      })
    );

    await alterarBase((b) => {
      for (const { m, r } of resultados) {
        const x = b.mensagens.find((y) => y.id === m.id);
        if (!x) continue;
        x.tentativas += 1;
        if (r.ok) {
          x.status = "enviada";
          x.enviadoEm = new Date().toISOString();
          x.idExterno = r.idExterno;
          x.erro = undefined;
          enviadas++;
        } else {
          erros++;
          x.erro = r.erro;
          // Número caiu ou provedor fora: volta pra fila e tenta de novo em 10 min, até 5 vezes
          if (x.tentativas >= 5) x.status = "erro";
          else {
            x.status = "fila";
            x.naoAntesDe = new Date(Date.now() + 10 * 60000).toISOString();
          }
        }
      }
    });
    return { enviadas, erros };
  } finally {
    processando = false;
  }
}

/** Adaptador do número oficial (site), quando configurado. */
export function adaptadorOficial(base: BaseCrm): { api: CloudApi; numero: string } | null {
  const of = oficialDe(base.config);
  return of.token && of.phoneNumberId ? { api: new CloudApi(of.token), numero: of.phoneNumberId } : null;
}

/** Dentro da janela do número oficial (o site vende todo dia, até mais tarde)? */
export function dentroDaJanelaOficial(base: BaseCrm): boolean {
  const { dia, hora } = agoraSp();
  const of = oficialDe(base.config);
  return of.dias.includes(dia) && hora >= of.inicio && hora < of.fim;
}

let processandoOficial = false;

/**
 * Fila do número oficial: manda como modelo aprovado, várias por passo (a Meta
 * não precisa do intervalo que protege os números comuns), até o teto do dia.
 */
export async function processarFilaOficial(ignorarJanela = false): Promise<ResultadoTick> {
  if (processandoOficial) return { enviadas: 0, erros: 0, motivo: "já processando" };
  processandoOficial = true;
  try {
    const base = await lerBase();
    const of = oficialDe(base.config);
    if (base.config.pausado) return { enviadas: 0, erros: 0, motivo: "pausado" };
    if (of.sombra) return { enviadas: 0, erros: 0, motivo: "modo sombra do site: nada sai" };
    const ad = adaptadorOficial(base);
    if (!ad) return { enviadas: 0, erros: 0, motivo: "WhatsApp oficial não configurado" };
    if (!ignorarJanela && !dentroDaJanelaOficial(base)) return { enviadas: 0, erros: 0, motivo: "fora do horário do site" };
    const hoje = hojeSp();
    const jaHoje = base.mensagens.filter((m) => m.provedor === "oficial" && m.enviadoEm?.startsWith(hoje) && ["enviada", "entregue", "lida", "respondida"].includes(m.status)).length;
    const cabe = Math.max(0, Math.min(20, of.tetoDia - jaHoje));
    if (!cabe) return { enviadas: 0, erros: 0, motivo: "teto do dia do site" };
    const agoraIso = new Date().toISOString();
    const escolhidas = base.mensagens
      .filter((m) => m.provedor === "oficial" && m.status === "fila" && m.naoAntesDe <= agoraIso)
      .sort((a, b) => a.naoAntesDe.localeCompare(b.naoAntesDe))
      .slice(0, cabe);
    if (!escolhidas.length) return { enviadas: 0, erros: 0 };
    await alterarBase((b) => {
      for (const m of escolhidas) {
        const x = b.mensagens.find((y) => y.id === m.id);
        if (x) x.status = "enviando";
      }
    });
    const resultados: { m: Mensagem; r: { ok: boolean; idExterno?: string; erro?: string } }[] = [];
    for (const m of escolhidas) {
      const r = m.template ? await ad.api.enviarTemplate(ad.numero, m.telefone, m.template) : { ok: false, erro: "sem modelo da Meta" };
      resultados.push({ m, r });
    }
    let enviadas = 0;
    let erros = 0;
    await alterarBase((b) => {
      for (const { m, r } of resultados) {
        const x = b.mensagens.find((y) => y.id === m.id);
        if (!x) continue;
        x.tentativas += 1;
        if (r.ok) {
          x.status = "enviada";
          x.enviadoEm = new Date().toISOString();
          x.idExterno = r.idExterno;
          x.erro = undefined;
          enviadas++;
        } else {
          erros++;
          x.erro = r.erro;
          // Erro de modelo/número não melhora sozinho: tenta mais 2 vezes e para
          if (x.tentativas >= 3) x.status = "erro";
          else {
            x.status = "fila";
            x.naoAntesDe = new Date(Date.now() + 10 * 60000).toISOString();
          }
        }
      }
    });
    return { enviadas, erros };
  } finally {
    processandoOficial = false;
  }
}

/** Resposta ou status que chegou pelo webhook do provedor. */
export interface EventoRecebido {
  tipo: "mensagem" | "status";
  sessao: string;
  /** Nome da sessão, quando o evento trouxer */
  sessaoNome?: string;
  telefone: string;
  texto?: string;
  idExterno?: string;
  status?: string;
  fromMe?: boolean;
  /** Quando a mensagem foi mandada (ISO), se o provedor informar */
  em?: string;
  /** Nome que a cliente usa no WhatsApp */
  nome?: string;
  /** Veio da busca de conversas (não do aviso na hora): pode ser antiga */
  recuperada?: boolean;
}

/**
 * A cliente está pedindo para não receber mais? Palavra sozinha ("SAIR",
 * "parar", "stop", com "por favor" ou emoji) ou frase clara ("me tira da
 * lista", "não quero mais receber", "parem de mandar"). "Cancelar a compra"
 * ou "pare aí na frente" não contam.
 */
export function pedeParaSair(texto?: string): boolean {
  const t = (texto ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!t) return false;
  if (/(quero sair|sair da (lista|lista de transmissao)|me (tira|tire|retira|retire|remove|remova|exclui|exclua|descadastra)|descadastr|nao (quero|desejo) (mais )?(receber|mensage)|(para|param|parar|pare|parem) de (me )?(mandar|enviar)|nao (me )?(mand|envi)(e|em) mais|remov(e|er|a) (meu|o meu) (numero|contato)|nao tenho interesse)/.test(t)) return true;
  const sobra = t.replace(/\b(por favor|pfv|pf|obrigad[ao]s?|obg|ok|ta|eu|quero|so)\b/g, " ").replace(/\s+/g, " ").trim();
  return /^(sair|sai|parar|pare|stop|cancelar|descadastrar|remover|chega)$/.test(sobra);
}

/**
 * A mensagem já está no atendimento? Pelo código do WhatsApp; para as gravadas
 * antes de o código existir, pela mesma loja, cliente, lado e horário (2 min).
 */
export function jaRegistrada(atendimento: Atendimento[], loja: string, ev: EventoRecebido): boolean {
  const de = ev.fromMe ? "loja" : "cliente";
  if (ev.idExterno && atendimento.some((a) => a.id === ev.idExterno)) return true;
  if (!ev.recuperada || !ev.em) return false;
  const t = new Date(ev.em).getTime();
  return atendimento.some((a) => !a.id && a.loja === loja && a.telefone === ev.telefone && a.de === de && Math.abs(new Date(a.em).getTime() - t) <= 120000);
}

/** Processa o que o webhook trouxe. Devolve o que fez (para o log). */
export async function receberEvento(ev: EventoRecebido): Promise<string> {
  const base = await lerBase();
  // O evento traz o código interno da sessão; a configuração pode ter o nome. Casamos pelos dois.
  const acharLoja = (chave?: string) => (chave ? base.config.numeros.find((n) => n.sessao.toLowerCase() === chave.toLowerCase())?.loja : undefined);
  const of = oficialDe(base.config);
  const doOficial = Boolean(of.phoneNumberId && ev.sessao === of.phoneNumberId);
  let loja = doOficial ? LOJA_OFICIAL : (acharLoja(ev.sessao) ?? acharLoja(ev.sessaoNome));
  if (!loja) {
    const nome = await adaptadorDe(base.config)?.nomeDaSessao?.(ev.sessao);
    loja = acharLoja(nome);
  }

  if (ev.tipo === "status" && ev.idExterno) {
    const mapa: Record<string, Mensagem["status"]> = { DELIVERED: "entregue", READ: "lida", PLAYED: "lida" };
    // Meta recusou depois de aceitar (número sem WhatsApp, modelo pausado, limite): vira erro
    if ((ev.status ?? "").toUpperCase() === "FAILED") {
      await alterarBase((b) => {
        const m = b.mensagens.find((x) => x.idExterno === ev.idExterno);
        if (m && m.status !== "respondida") {
          m.status = "erro";
          m.erro = ev.texto ? `Meta: ${ev.texto}` : "Meta não entregou";
        }
      });
      return "status erro";
    }
    const novo = mapa[(ev.status ?? "").toUpperCase()];
    if (!novo) return "status ignorado";
    await alterarBase((b) => {
      const m = b.mensagens.find((x) => x.idExterno === ev.idExterno);
      // Não rebaixa "respondida" para "lida"
      if (m && m.status !== "respondida" && (m.status === "enviada" || (m.status === "entregue" && novo === "lida"))) m.status = novo;
    });
    return `status ${novo}`;
  }

  if (ev.tipo !== "mensagem") return "ignorado";
  const texto = (ev.texto ?? "").trim();
  if (loja && jaRegistrada(base.atendimento, loja, ev)) return "repetida";

  // Resposta da loja (digitada no celular ou mandada pela API): só conta no atendimento
  if (ev.fromMe) {
    await alterarBase((b) => {
      if (!loja) return;
      if (jaRegistrada(b.atendimento, loja, ev)) return;
      b.atendimento.push({ loja, telefone: ev.telefone, de: "loja", em: ev.em ?? new Date().toISOString(), texto: (ev.texto ?? "").slice(0, 120) || undefined, id: ev.idExterno });
      if (b.atendimento.length > 30000) b.atendimento.splice(0, b.atendimento.length - 30000);
    });
    return loja ? "resposta da loja" : "ignorado";
  }

  let feito = "recebida";
  await alterarBase((b) => {
    if (loja) {
      b.atendimento.push({ loja, telefone: ev.telefone, de: "cliente", em: ev.em ?? new Date().toISOString(), texto: texto.slice(0, 120), nome: ev.nome, id: ev.idExterno });
      if (b.atendimento.length > 30000) b.atendimento.splice(0, b.atendimento.length - 30000);
    }
    const cliente = b.clientes.find((c) => c.telefone === ev.telefone);
    b.recebidas.push({
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      telefone: ev.telefone,
      clienteId: cliente?.id,
      loja,
      texto: texto.slice(0, 1000),
      recebidoEm: ev.recuperada && ev.em ? ev.em : new Date().toISOString(),
    });
    if (b.recebidas.length > 5000) b.recebidas.splice(0, b.recebidas.length - 5000);
    // Pedido de SAIR vale pelo telefone, mesmo de quem ainda não está cadastrada
    if (pedeParaSair(texto)) {
      (b.naoContatar ??= {})[ev.telefone] = { em: ev.em ?? new Date().toISOString(), loja, texto: texto.slice(0, 120) };
      feito = "opt-out";
    }
    if (!cliente) return;

    // Última mensagem nossa para ela nos últimos 7 dias vira "respondida"
    const limite = new Date(Date.now() - 7 * 86400000).toISOString();
    const nossa = b.mensagens
      .filter((m) => m.clienteId === cliente.id && m.enviadoEm && m.enviadoEm >= limite && m.status !== "cancelada")
      .sort((a, b2) => b2.enviadoEm!.localeCompare(a.enviadoEm!))[0];
    if (nossa && !nossa.resposta) {
      nossa.status = "respondida";
      nossa.resposta = texto.slice(0, 500);
      nossa.respondidoEm = new Date().toISOString();
      nossa.avaliada = true;
    }
    cliente.semResposta = 0;
    cliente.atualizadoEm = new Date().toISOString();

    if (feito === "opt-out") {
      cliente.optOut = true;
      cliente.optOutEm = new Date().toISOString();
      // Cancela o que ainda estava na fila para ela
      for (const m of b.mensagens) if (m.clienteId === cliente.id && m.status === "fila") m.status = "cancelada";
      feito = "opt-out";
    }
  });

  // Confirma o opt-out com uma mensagem só, fora da fila (é resposta, não campanha).
  // Em modo sombra ou pausado, nem isso sai.
  // Mensagem recuperada de horas atrás: marca o opt-out, mas não responde fora de hora
  const recente = !ev.recuperada || !ev.em || Date.now() - new Date(ev.em).getTime() < 3 * 3600000;
  const sombra = doOficial ? of.sombra : base.config.modoSombra;
  if (feito === "opt-out" && recente && !sombra && !base.config.pausado) {
    const confirmacao = "Tudo bem, não mandamos mais mensagens por aqui. Se mudar de ideia, é só chamar a gente.";
    // Pelo oficial é resposta dentro das 24h que ela abriu: texto livre vale
    const adaptador = doOficial ? adaptadorOficial(base)?.api : adaptadorDe(base.config);
    if (adaptador) void adaptador.enviarTexto(ev.sessao, ev.telefone, confirmacao);
  }
  return feito;
}
