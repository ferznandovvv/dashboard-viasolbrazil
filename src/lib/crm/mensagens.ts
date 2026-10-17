/**
 * Montagem de mensagens a partir dos modelos (com variações, para não sair
 * sempre o mesmo texto do mesmo número) e entrada na fila.
 */

import { brl, dataBr, novoId, primeiroNome, somarDias, hojeSp } from "./base";
import { gerarCodigo } from "./cashback";
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
  /** Primeiro nome de quem assina (vendedora da venda ou da loja) */
  vendedora?: string;
  /** Compra mínima para usar o cashback, já formatada */
  compraMinima?: string;
}

/** Compra mínima para usar `valor` de cashback, pela regra do múltiplo. */
export function compraMinimaPara(base: BaseCrm, valor?: number): string {
  if (valor === undefined) return "";
  const m = base.config.cashbackMultiploCompra;
  if (m > 0) return brl(Math.ceil(valor * m));
  const pct = base.config.cashbackMaxPctDaCompra;
  if (pct > 0) return brl(Math.ceil((valor * 100) / pct));
  return "qualquer valor";
}

/** Quem assina: a vendedora da venda, senão a configurada para a loja, senão a equipe. */
export function assinatura(base: BaseCrm, loja?: string, vendedoraCpf?: string): string {
  const nome = vendedoraCpf ? base.vendedoras?.[vendedoraCpf] : undefined;
  const configurada = base.config.numeros.find((n) => n.loja === loja)?.vendedora;
  const escolhido = (nome || configurada || "").trim();
  if (!escolhido) return "equipe";
  const p = escolhido.split(/\s+/)[0];
  return p[0].toUpperCase() + p.slice(1).toLowerCase();
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
    .replace(/\{vendedora\}/g, v.vendedora ?? "equipe")
    .replace(/\{compraMinima\}/g, v.compraMinima ?? "")
    // "aqui é a equipe" fica estranho: vira "aqui é da equipe"
    .replace(/\b([EeÉé]) a equipe\b/g, "$1 da equipe")
    .replace(/\bSou a equipe\b/g, "Somos a equipe")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Escolhe uma variação do modelo (ou null se a campanha está desligada / sem texto). */
export function textoDaCampanha(base: BaseCrm, campanha: TipoCampanha, cliente: Cliente, loja: string, v: Variaveis = {}): string | null {
  const modelo = base.modelos.find((m) => m.campanha === campanha);
  if (!modelo || !modelo.ativo) return null;
  const opcoes = modelo.variacoes.map((t) => t.trim()).filter(Boolean);
  if (!opcoes.length) return null;
  const completo: Variaveis = {
    ...v,
    vendedora: v.vendedora ?? assinatura(base, v.lojaProxima ?? loja),
    compraMinima: v.compraMinima ?? compraMinimaPara(base, v.valor),
  };
  return renderizar(opcoes[Math.floor(Math.random() * opcoes.length)], cliente, loja, completo);
}

export const ehMarketing = (campanha: TipoCampanha) => CAMPANHAS.find((c) => c.id === campanha)?.marketing ?? true;

/**
 * Loja cujo número vai mandar: sempre o da própria loja. Loja física sem
 * número ainda não manda (não faz sentido o número do Centro mandar mensagem
 * assinada pela loja de Ribeirão). Só cliente do site, ou sem loja, sai pelo
 * primeiro número ativo.
 */
export function lojaDeEnvio(base: BaseCrm, preferida?: string): string | undefined {
  const ativos = base.config.numeros.filter((n) => n.ativo && n.sessao);
  const propria = ativos.find((n) => n.loja === preferida);
  if (propria) return propria.loja;
  if (preferida && preferida !== "Site") return undefined;
  return ativos[0]?.loja;
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
  /** Ignora regras de opt-in/marketing e do limite mensal (só para envio manual) */
  forcar?: boolean;
  /** Gera um código de resgate da oferta, amarrado à campanha, e o põe em {codigo} */
  oferta?: string;
  /** Campanha manual que gerou */
  campanhaId?: string;
}

/** Campanhas que não contam no limite mensal: são consequência direta de uma compra dela. */
const FORA_DO_LIMITE: TipoCampanha[] = ["cashback_creditado", "cashback_site_perto", "cashback_site_longe", "boas_vindas"];

/**
 * A mensagem conta para limite e repetição? Cancelada e erro não. Simulada
 * conta só enquanto o modo sombra está ligado (pra simulação ser realista);
 * desligado, ela some das contas e a cliente pode receber a de verdade.
 */
export const conta = (base: BaseCrm, m: Mensagem) =>
  m.status !== "cancelada" && m.status !== "erro" && (m.status !== "simulada" || base.config.modoSombra);

/** Mensagens mandadas (ou na fila) para a cliente nos últimos 30 dias, de campanhas que contam. */
export function mensagensNoMes(base: BaseCrm, clienteId: string): number {
  const desde = new Date(Date.now() - 30 * 86400000).toISOString();
  return base.mensagens.filter(
    (m) => m.clienteId === clienteId && !FORA_DO_LIMITE.includes(m.campanha) && m.criadoEm >= desde && conta(base, m)
  ).length;
}

/** Por que a cliente não pode receber esta campanha agora (ou undefined se pode). */
export function motivoBloqueio(base: BaseCrm, c: Cliente, campanha: TipoCampanha, forcar = false): string | undefined {
  if (!c.telefone) return "sem telefone";
  if (forcar) return undefined;
  if (c.optOut) return "pediu para não receber";
  if (!c.optIn) return "sem aceite";
  if (ehMarketing(campanha) && c.semResposta >= base.config.maxSemResposta) return "sem resposta nas últimas campanhas";
  if (!FORA_DO_LIMITE.includes(campanha) && mensagensNoMes(base, c.id) >= base.config.maxMensagensMes) return "já recebeu o máximo do mês";
  return undefined;
}

/** Põe na fila (ou, em modo sombra, registra como simulada). Devolve a mensagem ou o motivo de não ter entrado. */
export function enfileirar(base: BaseCrm, p: PedidoFila): { mensagem?: Mensagem; motivo?: string } {
  const c = p.cliente;
  const bloqueio = motivoBloqueio(base, c, p.campanha, p.forcar);
  if (bloqueio) return { motivo: bloqueio };
  if (p.chave && base.mensagens.some((m) => m.chave === p.chave && m.status !== "cancelada" && (m.status !== "simulada" || base.config.modoSombra))) return { motivo: "já enviada" };
  const lojaRef = p.loja ?? c.lojaOrigem;
  const loja = lojaDeEnvio(base, lojaRef);
  if (!loja) return { motivo: base.config.numeros.some((n) => n.ativo && n.sessao) ? `loja ${lojaRef} ainda sem número` : "nenhum número de WhatsApp configurado" };
  const id = novoId();
  // Oferta vira um código único: a vendedora digita no caixa e a gente sabe qual campanha trouxe a cliente
  let codigo: string | undefined;
  if (p.oferta) {
    codigo = gerarCodigo(base);
    base.codigos.push({ codigo, clienteId: c.id, valor: 0, oferta: p.oferta, campanha: p.campanha, mensagemId: id, criadoEm: new Date().toISOString(), validade: somarDias(hojeSp(), 45) });
  }
  const ref = lojaRef ?? loja;
  const texto = p.texto?.trim()
    ? renderizar(p.texto, c, ref, { vendedora: assinatura(base, ref), compraMinima: compraMinimaPara(base, p.variaveis?.valor), ...p.variaveis, codigo })
    : textoDaCampanha(base, p.campanha, c, ref, { ...p.variaveis, codigo });
  if (!texto) {
    if (codigo) base.codigos.splice(base.codigos.findIndex((x) => x.codigo === codigo), 1);
    return { motivo: "campanha desligada ou sem texto" };
  }
  const m: Mensagem = {
    id,
    clienteId: c.id,
    telefone: c.telefone!,
    campanha: p.campanha,
    loja,
    texto,
    status: base.config.modoSombra ? "simulada" : "fila",
    naoAntesDe: p.naoAntesDe ?? new Date().toISOString(),
    criadoEm: new Date().toISOString(),
    tentativas: 0,
    chave: p.chave,
    campanhaId: p.campanhaId,
  };
  base.mensagens.push(m);
  return { mensagem: m };
}
