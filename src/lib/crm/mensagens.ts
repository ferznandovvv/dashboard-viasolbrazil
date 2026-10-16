/**
 * Montagem de mensagens a partir dos modelos (com variações, para não sair
 * sempre o mesmo texto do mesmo número) e entrada na fila.
 */

import { brl, dataBr, novoId, primeiroNome } from "./base";
import { CAMPANHAS, type BaseCrm, type Cliente, type Mensagem, type TipoCampanha } from "./tipos";

export interface Variaveis {
  valor?: number;
  validade?: string;
  codigo?: string;
  loja?: string;
  /** Oferta da campanha (aniversário, reativação) */
  oferta?: string;
  /** Loja na cidade da cliente (cashback do site) */
  lojaProxima?: string;
  /** Cidade escrita bonito (a do cadastro pode vir sem acento) */
  cidade?: string;
}

export function renderizar(texto: string, cliente: Cliente, loja: string, v: Variaveis = {}): string {
  return texto
    .replace(/\{primeiro\}/g, primeiroNome(cliente.nome))
    .replace(/\{nome\}/g, cliente.nome.trim())
    .replace(/\{loja\}/g, v.loja ?? loja)
    .replace(/\{valor\}/g, v.valor !== undefined ? brl(v.valor) : "")
    .replace(/\{validade\}/g, v.validade ? dataBr(v.validade) : "")
    .replace(/\{codigo\}/g, v.codigo ?? "")
    .replace(/\{oferta\}/g, v.oferta ?? "")
    .replace(/\{lojaProxima\}/g, v.lojaProxima ?? v.loja ?? loja)
    .replace(/\{cidade\}/g, v.cidade ?? cliente.cidade ?? "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Escolhe uma variação do modelo (ou null se a campanha está desligada / sem texto). */
export function textoDaCampanha(base: BaseCrm, campanha: TipoCampanha, cliente: Cliente, loja: string, v: Variaveis = {}): string | null {
  const modelo = base.modelos.find((m) => m.campanha === campanha);
  if (!modelo || !modelo.ativo) return null;
  const opcoes = modelo.variacoes.map((t) => t.trim()).filter(Boolean);
  if (!opcoes.length) return null;
  return renderizar(opcoes[Math.floor(Math.random() * opcoes.length)], cliente, loja, v);
}

export const ehMarketing = (campanha: TipoCampanha) => CAMPANHAS.find((c) => c.id === campanha)?.marketing ?? true;

/** Loja cujo número vai mandar: a da venda/origem, se tiver número; senão a primeira ativa. */
export function lojaDeEnvio(base: BaseCrm, preferida?: string): string | undefined {
  const ativos = base.config.numeros.filter((n) => n.ativo && n.sessao);
  if (!ativos.length) return undefined;
  return ativos.find((n) => n.loja === preferida)?.loja ?? ativos[0].loja;
}

export interface PedidoFila {
  cliente: Cliente;
  campanha: TipoCampanha;
  /** Loja de referência (a mensagem sai pelo número dela, se existir) */
  loja?: string;
  /** Texto pronto; se não vier, usa o modelo da campanha */
  texto?: string;
  variaveis?: Variaveis;
  /** Impede duplicar: mesma chave não entra duas vezes */
  chave?: string;
  /** Não mandar antes disto (ISO); padrão agora */
  naoAntesDe?: string;
  /** Ignora regras de opt-in/marketing (só para teste manual) */
  forcar?: boolean;
}

/** Põe na fila. Devolve a mensagem ou o motivo de não ter entrado. */
export function enfileirar(base: BaseCrm, p: PedidoFila): { mensagem?: Mensagem; motivo?: string } {
  const c = p.cliente;
  if (!c.telefone) return { motivo: "sem telefone" };
  if (!p.forcar) {
    if (c.optOut) return { motivo: "pediu para não receber" };
    if (!c.optIn) return { motivo: "sem aceite" };
    if (ehMarketing(p.campanha) && c.semResposta >= base.config.maxSemResposta) return { motivo: "sem resposta nas últimas campanhas" };
  }
  if (p.chave && base.mensagens.some((m) => m.chave === p.chave && m.status !== "cancelada")) return { motivo: "já enviada" };
  const lojaRef = p.loja ?? c.lojaOrigem;
  const loja = lojaDeEnvio(base, lojaRef);
  if (!loja) return { motivo: "nenhum número de WhatsApp configurado" };
  const texto = p.texto?.trim() || textoDaCampanha(base, p.campanha, c, lojaRef ?? loja, p.variaveis);
  if (!texto) return { motivo: "campanha desligada ou sem texto" };
  const m: Mensagem = {
    id: novoId(),
    clienteId: c.id,
    telefone: c.telefone,
    campanha: p.campanha,
    loja,
    texto,
    status: "fila",
    naoAntesDe: p.naoAntesDe ?? new Date().toISOString(),
    criadoEm: new Date().toISOString(),
    tentativas: 0,
    chave: p.chave,
  };
  base.mensagens.push(m);
  return { mensagem: m };
}
