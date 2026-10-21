/**
 * Montagem de mensagens a partir dos modelos (com variações, para não sair
 * sempre o mesmo texto do mesmo número) e entrada na fila.
 */

import { brl, dataBr, novoId, primeiroNome, somarDias, hojeSp } from "./base";
import { gerarCodigo } from "./cashback";
import { CAMPANHAS, CAMPANHAS_SITE, LOJA_OFICIAL, oficialDe, type BaseCrm, type Cliente, type Mensagem, type TipoCampanha } from "./tipos";

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
  /** Endereço da loja próxima (vira " (endereço)" no texto, ou nada) */
  endereco?: string;
  /** Dia da compra (AAAA-MM-DD): vira {quando} = "ontem" / "no dia 16/10" e {daCompra} = "de ontem" / "do dia 16/10" */
  dataCompra?: string;
  /** Site: o que ficou no carrinho ("Biquíni Ana e mais 1 peça"), link do carrinho/pedido e número do pedido */
  itens?: string;
  link?: string;
  pedido?: string;
  /** Pix: hora em que o código vence ("15:54") */
  expira?: string;
}

/** Valor de uma variável, pra preencher {{1}}, {{2}}... do modelo da Meta. */
export function valorDaVariavel(chave: string, cliente: Cliente, v: Variaveis): string {
  switch (chave) {
    case "primeiro":
      return primeiroNome(cliente.nome) || "tudo bem";
    case "nome":
      return cliente.nome.trim() || "cliente";
    case "valor":
      return v.valor !== undefined ? brl(v.valor) : "";
    case "validade":
      return v.validade ? dataBr(v.validade) : "";
    case "itens":
      return v.itens ?? "suas peças";
    case "link":
      return v.link ?? "";
    case "pedido":
      return v.pedido ?? "";
    case "expira":
      return v.expira ?? "";
    case "loja":
      return v.loja ?? "";
    default:
      return "";
  }
}

/** Final do link para o botão do modelo (a parte depois do domínio): o modelo tem o começo fixo. */
export function sufixoDoLink(link: string | undefined): string | undefined {
  if (!link) return undefined;
  try {
    const u = new URL(link);
    return `${u.pathname.replace(/^\//, "")}${u.search}`;
  } catch {
    return undefined;
  }
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
  const apelido = vendedoraCpf ? base.config.apelidos?.[vendedoraCpf]?.trim() : undefined;
  if (apelido) return apelido;
  const nome = vendedoraCpf ? base.vendedoras?.[vendedoraCpf] : undefined;
  const configurada = base.config.numeros.find((n) => n.loja === loja)?.vendedora;
  const escolhido = (nome || configurada || "").trim();
  if (!escolhido) return "equipe";
  const p = escolhido.split(/\s+/)[0];
  return p[0].toUpperCase() + p.slice(1).toLowerCase();
}

/** "ontem" se a compra foi ontem; senão "no dia 16/10" (ou "do dia 16/10"). Sem data: vazio. */
function quandoFoi(data: string | undefined, ontem: string, prefixo: string): string {
  if (!data) return "";
  const d = data.slice(0, 10);
  if (d === somarDias(hojeSp(), -1)) return ontem;
  return `${prefixo} ${d.slice(8, 10)}/${d.slice(5, 7)}`;
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
    .replace(/\{endereco\}/g, v.endereco?.trim() ? ` (${v.endereco.trim()})` : "")
    .replace(/\{quando\}/g, quandoFoi(v.dataCompra, "ontem", "no dia"))
    .replace(/\{daCompra\}/g, quandoFoi(v.dataCompra, "de ontem", "do dia"))
    .replace(/\{itens\}/g, v.itens ?? "suas peças")
    .replace(/\{link\}/g, v.link ?? "")
    .replace(/\{pedido\}/g, v.pedido ?? "")
    .replace(/\{expira\}/g, v.expira ?? "")
    // Sem vendedora: "aqui é a equipe, da Via Sol Centro" vira "aqui é da Via Sol Centro"
    .replace(/(^|[\s,])([EeÉé]) a equipe,? da /g, "$1$2 da ")
    .replace(/(^|[\s,])([EeÉé]) a equipe\b/g, "$1$2 da equipe")
    .replace(/(^|[\s,])Sou a equipe\b/g, "$1Somos a equipe")
    .replace(/(^|[\s!.,])equipe aqui, da /gi, "$1aqui é da ")
    .replace(/(^|[\s!.,])equipe aqui\b/gi, "$1aqui é da equipe")
    .replace(/(^|\s)equipe, da /g, "$1Aqui é da ")
    .replace(/([!?.]\s+)aqui é da/g, "$1Aqui é da")
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
  const emprestada = emprestimoDe(base, preferida);
  if (emprestada) return emprestada;
  if (preferida && preferida !== "Site") return undefined;
  return ativos[0]?.loja;
}

/**
 * Loja sem número ligado que manda pelo número de outra (Configurar › Números):
 * devolve a loja dona do número, se ele estiver ligado.
 */
export function emprestimoDe(base: BaseCrm, loja?: string): string | undefined {
  if (!loja) return undefined;
  const n = base.config.numeros.find((x) => x.loja === loja);
  if (!n?.mandarPor || (n.ativo && n.sessao)) return undefined;
  return base.config.numeros.some((x) => x.loja === n.mandarPor && x.ativo && x.sessao) ? n.mandarPor : undefined;
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
  /** Segunda mensagem, mandada logo depois (só pela WA-AKG): o código Pix sozinho */
  complemento?: string;
}

/** Campanhas que não contam no limite mensal: são consequência direta de uma compra dela. */
const FORA_DO_LIMITE: TipoCampanha[] = ["cashback_creditado", "cashback_site_perto", "cashback_site_longe", "boas_vindas", "carrinho_abandonado", "pix_pendente", "pix_expirado"];

/**
 * A mensagem conta para limite e repetição? Cancelada e erro não. Simulada
 * conta só enquanto o modo sombra está ligado (pra simulação ser realista);
 * desligado, ela some das contas e a cliente pode receber a de verdade.
 */
export const conta = (base: BaseCrm, m: Mensagem) =>
  m.status !== "cancelada" && m.status !== "erro" && (m.status !== "simulada" || sombraDe(base, m));

/**
 * A campanha sai pela API oficial? Se ela está marcada pro oficial e ele está
 * configurado, sim. Marcada mas sem a Meta pronta: sai pelo número do site na
 * WA-AKG, se ele estiver ligado (tapa-buraco); senão simula no oficial.
 */
export function viaOficial(base: BaseCrm, campanha: TipoCampanha): boolean {
  const of = oficialDe(base.config);
  if (!of.campanhas.includes(campanha)) return false;
  if (of.token && of.phoneNumberId) return true;
  return !base.config.numeros.some((n) => n.loja === LOJA_OFICIAL && n.ativo && n.sessao);
}

/** O modo sombra que vale para a mensagem: o do número oficial ou o das lojas. */
const sombraDe = (base: BaseCrm, m: Pick<Mensagem, "provedor">) => (m.provedor === "oficial" ? oficialDe(base.config).sombra : base.config.modoSombra);

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
  if (c.optOut || base.naoContatar?.[c.telefone]) return "pediu para não receber";
  // Carrinho e Pix nascem do que ela acabou de fazer no site (deixou o telefone no checkout):
  // não dependem do aceite de marketing, a não ser que a configuração peça
  const doSite = CAMPANHAS_SITE.includes(campanha);
  const exigeAceite = !doSite || (campanha === "carrinho_abandonado" && oficialDe(base.config).carrinhoSoComAceite);
  if (exigeAceite && !c.optIn) return "sem aceite";
  if (ehMarketing(campanha) && c.semResposta >= base.config.maxSemResposta) return "sem resposta nas últimas campanhas";
  if (!FORA_DO_LIMITE.includes(campanha) && mensagensNoMes(base, c.id) >= base.config.maxMensagensMes) return "já recebeu o máximo do mês";
  return undefined;
}

/** Põe na fila (ou, em modo sombra, registra como simulada). Devolve a mensagem ou o motivo de não ter entrado. */
export function enfileirar(base: BaseCrm, p: PedidoFila): { mensagem?: Mensagem; motivo?: string } {
  const c = p.cliente;
  const bloqueio = motivoBloqueio(base, c, p.campanha, p.forcar);
  if (bloqueio) return { motivo: bloqueio };
  if (p.chave && base.mensagens.some((m) => m.chave === p.chave && m.status !== "cancelada" && (m.status !== "simulada" || sombraDe(base, m)))) return { motivo: "já enviada" };
  if (viaOficial(base, p.campanha)) return enfileirarOficial(base, p);
  // Carrinho e Pix fora da API oficial: só pelo número do site na WA-AKG, nunca pelo de uma loja
  if (CAMPANHAS_SITE.includes(p.campanha) && !base.config.numeros.some((n) => n.loja === LOJA_OFICIAL && n.ativo && n.sessao)) return { motivo: "número do site não ligado (Números › Site)" };
  let lojaRef = CAMPANHAS_SITE.includes(p.campanha) ? LOJA_OFICIAL : (p.loja ?? c.lojaOrigem);
  // Loja que manda pelo número de outra: a mensagem fala e assina como a dona do número
  // (quem responde é a equipe de lá)
  const dona = emprestimoDe(base, lojaRef);
  if (dona) {
    lojaRef = dona;
    p = { ...p, loja: dona, variaveis: { ...p.variaveis, vendedora: assinatura(base, dona), loja: undefined } };
  }
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
    ? renderizar(p.texto, c, ref, { vendedora: assinatura(base, ref), compraMinima: compraMinimaPara(base, p.variaveis?.valor), ...p.variaveis, codigo: codigo ?? p.variaveis?.codigo })
    : textoDaCampanha(base, p.campanha, c, ref, { ...p.variaveis, codigo: codigo ?? p.variaveis?.codigo });
  if (!texto) {
    if (codigo) base.codigos.splice(base.codigos.findIndex((x) => x.codigo === codigo), 1);
    return { motivo: "campanha desligada ou sem texto" };
  }
  // Primeira mensagem dela: uma linha dizendo como sair (menos denúncia, mais "SAIR")
  const primeira = !base.mensagens.some((x) => x.clienteId === c.id && conta(base, x));
  const textoFinal = base.config.avisoSair && primeira && base.config.textoSair ? `${texto}\n\n${base.config.textoSair}` : texto;
  const m: Mensagem = {
    id,
    clienteId: c.id,
    telefone: c.telefone!,
    campanha: p.campanha,
    loja,
    texto: textoFinal,
    status: base.config.modoSombra ? "simulada" : "fila",
    naoAntesDe: p.naoAntesDe ?? new Date().toISOString(),
    criadoEm: new Date().toISOString(),
    tentativas: 0,
    chave: p.chave,
    campanhaId: p.campanhaId,
    complemento: p.complemento,
  };
  base.mensagens.push(m);
  return { mensagem: m };
}

/**
 * Pela API oficial (número do site): sai como modelo aprovado na Meta, com as
 * variáveis já preenchidas. Em sombra entra como simulada mesmo sem a Meta
 * configurada, pra ver o volume antes de ligar.
 */
function enfileirarOficial(base: BaseCrm, p: PedidoFila): { mensagem?: Mensagem; motivo?: string } {
  const c = p.cliente;
  const of = oficialDe(base.config);
  const modelo = base.modelos.find((m) => m.campanha === p.campanha);
  if (!modelo?.ativo) return { motivo: "campanha desligada" };
  if (!of.sombra) {
    if (!of.token || !of.phoneNumberId) return { motivo: "WhatsApp oficial não configurado" };
    if (!modelo.template?.nome) return { motivo: "campanha sem modelo aprovado na Meta" };
  }
  const v: Variaveis = { loja: LOJA_OFICIAL, ...p.variaveis };
  const texto = renderizar(modelo.variacoes.find((t) => t.trim()) ?? "", c, LOJA_OFICIAL, v);
  const t = modelo.template;
  const m: Mensagem = {
    id: novoId(),
    clienteId: c.id,
    telefone: c.telefone!,
    campanha: p.campanha,
    loja: LOJA_OFICIAL,
    texto,
    status: of.sombra ? "simulada" : "fila",
    naoAntesDe: p.naoAntesDe ?? new Date().toISOString(),
    criadoEm: new Date().toISOString(),
    tentativas: 0,
    chave: p.chave,
    campanhaId: p.campanhaId,
    provedor: "oficial",
    template: t
      ? {
          nome: t.nome,
          idioma: t.idioma || "pt_BR",
          parametros: t.parametros.map((k) => valorDaVariavel(k, c, v)),
          botao: t.botaoLink ? sufixoDoLink(v.link) : undefined,
        }
      : undefined,
  };
  base.mensagens.push(m);
  return { mensagem: m };
}
