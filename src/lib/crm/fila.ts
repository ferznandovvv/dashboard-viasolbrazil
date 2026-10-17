/**
 * A fila de envio: tira uma mensagem por vez de cada número, respeitando
 * horário comercial, teto diário por número e intervalo aleatório entre
 * mensagens. É isso que protege os números, não o provedor.
 *
 * Roda a cada 20 segundos pelo agendador quando o sistema está na máquina.
 */

import { adaptadorDe } from "./envio/adaptador";
import { alterarBase, hojeSp, lerBase } from "./base";
import type { BaseCrm, Mensagem } from "./tipos";

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
    if (!ignorarJanela && !dentroDaJanela(base)) return { enviadas: 0, erros: 0, motivo: "fora do horário de envio" };

    const agora = Date.now();
    const agoraIso = new Date(agora).toISOString();
    const hoje = hojeSp();
    const escolhidas: Mensagem[] = [];

    for (const n of cfg.numeros.filter((x) => x.ativo && x.sessao)) {
      if ((proximoEnvio.get(n.loja) ?? 0) > agora) continue;
      if (enviadasHoje(base, n.loja, hoje) >= (n.tetoDia ?? cfg.tetoDiaPorNumero)) continue;
      const m = base.mensagens
        .filter((x) => x.loja === n.loja && x.status === "fila" && x.naoAntesDe <= agoraIso)
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
}

const OPT_OUT = /^\s*(sair|parar|pare|stop|cancelar|cancela|remover|descadastrar|n[aã]o quero( mais)?( receber)?)\b/i;

/** Processa o que o webhook trouxe. Devolve o que fez (para o log). */
export async function receberEvento(ev: EventoRecebido): Promise<string> {
  const base = await lerBase();
  // O evento traz o código interno da sessão; a configuração pode ter o nome. Casamos pelos dois.
  const acharLoja = (chave?: string) => (chave ? base.config.numeros.find((n) => n.sessao.toLowerCase() === chave.toLowerCase())?.loja : undefined);
  let loja = acharLoja(ev.sessao) ?? acharLoja(ev.sessaoNome);
  if (!loja) {
    const nome = await adaptadorDe(base.config)?.nomeDaSessao?.(ev.sessao);
    loja = acharLoja(nome);
  }

  if (ev.tipo === "status" && ev.idExterno) {
    const mapa: Record<string, Mensagem["status"]> = { DELIVERED: "entregue", READ: "lida", PLAYED: "lida" };
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

  // Resposta da loja (digitada no celular ou mandada pela API): só conta no atendimento
  if (ev.fromMe) {
    await alterarBase((b) => {
      if (!loja) return;
      b.atendimento.push({ loja, telefone: ev.telefone, de: "loja", em: new Date().toISOString() });
      if (b.atendimento.length > 30000) b.atendimento.splice(0, b.atendimento.length - 30000);
    });
    return loja ? "resposta da loja" : "ignorado";
  }

  let feito = "recebida";
  await alterarBase((b) => {
    if (loja) {
      b.atendimento.push({ loja, telefone: ev.telefone, de: "cliente", em: new Date().toISOString(), texto: texto.slice(0, 120) });
      if (b.atendimento.length > 30000) b.atendimento.splice(0, b.atendimento.length - 30000);
    }
    const cliente = b.clientes.find((c) => c.telefone === ev.telefone);
    b.recebidas.push({
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      telefone: ev.telefone,
      clienteId: cliente?.id,
      loja,
      texto: texto.slice(0, 1000),
      recebidoEm: new Date().toISOString(),
    });
    if (b.recebidas.length > 5000) b.recebidas.splice(0, b.recebidas.length - 5000);
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

    if (OPT_OUT.test(texto)) {
      cliente.optOut = true;
      cliente.optOutEm = new Date().toISOString();
      // Cancela o que ainda estava na fila para ela
      for (const m of b.mensagens) if (m.clienteId === cliente.id && m.status === "fila") m.status = "cancelada";
      feito = "opt-out";
    }
  });

  // Confirma o opt-out com uma mensagem só, fora da fila (é resposta, não campanha).
  // Em modo sombra ou pausado, nem isso sai.
  if (feito === "opt-out" && !base.config.modoSombra && !base.config.pausado) {
    const adaptador = adaptadorDe(base.config);
    if (adaptador) void adaptador.enviarTexto(ev.sessao, ev.telefone, "Tudo bem, não mandamos mais mensagens por aqui. Se mudar de ideia, é só chamar a gente.");
  }
  return feito;
}
