/**
 * Busca das conversas na WA-AKG. O aviso (webhook) da WA-AKG é tentado uma vez
 * só: se o painel estava desligado, atualizando ou o túnel oscilou, a mensagem
 * fica na WA-AKG e no celular, mas não chega aqui. Esta busca completa o que
 * faltar (até 3 dias para trás), sem duplicar: cada mensagem tem o código do
 * WhatsApp.
 */

import { lerBase } from "./base";
import { adaptadorDe } from "./envio/adaptador";
import { jaRegistrada, receberEvento, type EventoRecebido } from "./fila";

const TRES_DIAS = 72 * 3600000;
/** Última busca que deu certo (na memória: ao ligar, olha os 3 dias) */
let ultimaBusca: string | null = null;
let rodando = false;

const telefoneDoJid = (jid: string) => jid.split("@")[0].split(":")[0].replace(/\D/g, "");

export async function recuperarConversas(): Promise<Record<string, string>> {
  if (rodando) return {};
  rodando = true;
  try {
    const base = await lerBase();
    const adaptador = adaptadorDe(base.config);
    const r: Record<string, string> = {};
    if (!adaptador?.conversasRecentes) return r;
    const agora = new Date();
    const limite = new Date(agora.getTime() - TRES_DIAS).toISOString();
    // Volta 30 min além da última busca, para pegar o que chegou enquanto ela rodava
    const desde = ultimaBusca && ultimaBusca > limite ? new Date(new Date(ultimaBusca).getTime() - 30 * 60000).toISOString() : limite;
    let tudoCerto = true;

    for (const n of base.config.numeros.filter((x) => x.ativo && x.sessao)) {
      try {
        const msgs = (await adaptador.conversasRecentes(n.sessao, desde)).sort((a, b) => a.em.localeCompare(b.em));
        const atual = await lerBase();
        let novas = 0;
        for (const m of msgs) {
          const tipo = m.tipo.toUpperCase();
          const conteudo = m.conteudo.trim();
          // Reação, mensagem apagada e afins: não é conversa (igual ao aviso)
          if (!conteudo && (tipo === "TEXT" || tipo === "UNKNOWN")) continue;
          const telefone = telefoneDoJid(m.jid);
          if (telefone.length < 10) continue;
          const ev: EventoRecebido = {
            tipo: "mensagem",
            sessao: n.sessao,
            telefone,
            fromMe: m.fromMe,
            texto: conteudo || `[${tipo.toLowerCase()}]`,
            idExterno: m.id || undefined,
            em: m.em,
            nome: m.fromMe ? undefined : m.nome,
            recuperada: true,
          };
          if (jaRegistrada(atual.atendimento, n.loja, ev)) continue;
          const feito = await receberEvento(ev);
          if (feito !== "repetida" && feito !== "ignorado") novas++;
        }
        r[n.loja] = novas ? `${novas} mensagem(ns) recuperada(s)` : "em dia";
      } catch (e) {
        tudoCerto = false;
        r[n.loja] = `não consegui buscar (${e instanceof Error ? e.message : e})`;
      }
    }
    if (tudoCerto) ultimaBusca = agora.toISOString();
    return r;
  } finally {
    rodando = false;
  }
}
