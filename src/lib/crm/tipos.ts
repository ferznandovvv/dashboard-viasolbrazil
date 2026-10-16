/**
 * Tipos do CRM das lojas físicas. Ficam separados do acesso a disco para a
 * tela (cliente) poder importar os rótulos sem levar `fs` junto.
 */

export interface Cliente {
  id: string;
  nome: string;
  /** Telefone normalizado: só dígitos, com DDI 55 (ex.: 5516999998888) */
  telefone?: string;
  /** Só dígitos */
  cpf?: string;
  email?: string;
  /** YYYY-MM-DD */
  nascimento?: string;
  /** Loja onde comprou pela primeira vez (ou onde foi cadastrada) */
  lojaOrigem?: string;
  /** Código do cliente no TOTVS, quando veio de lá */
  codigoTotvs?: string;
  /** Id do cliente na Shopify (gid numérico), quando comprou no site */
  codigoShopify?: string;
  /** Aceitou receber mensagens no WhatsApp (LGPD) */
  optIn: boolean;
  /** Pediu para não receber mais (respondeu SAIR ou foi marcado na tela) */
  optOut?: boolean;
  optOutEm?: string;
  /** Campanhas de marketing seguidas sem resposta nenhuma */
  semResposta: number;
  criadoEm: string;
  atualizadoEm: string;
  /** Observação livre da vendedora */
  obs?: string;
}

export interface Venda {
  id: string;
  clienteId?: string;
  /** Nome como veio na nota, para conciliar depois se o cliente ainda não existia */
  nomeNaNota?: string;
  codigoClienteTotvs?: string;
  cpfNaNota?: string;
  loja: string;
  /** ISO com fuso */
  data: string;
  valor: number;
  pecas?: number;
  origem: "totvs" | "shopify" | "csv" | "manual";
}

export type TipoMovimento = "credito" | "resgate" | "expiracao" | "ajuste";

export interface MovimentoCashback {
  id: string;
  clienteId: string;
  tipo: TipoMovimento;
  /** Positivo para crédito, negativo para resgate/expiração */
  valor: number;
  /** Venda que gerou o crédito */
  vendaId?: string;
  /** Crédito: até quando vale (YYYY-MM-DD) */
  validade?: string;
  /** Resgate: código usado e loja */
  codigo?: string;
  loja?: string;
  obs?: string;
  criadoEm: string;
  /** Quem registrou (vendedora, sistema) */
  por?: string;
}

/** Código de resgate gerado para a cliente usar no caixa, uma vez só. */
export interface CodigoResgate {
  codigo: string;
  clienteId: string;
  valor: number;
  criadoEm: string;
  /** YYYY-MM-DD */
  validade: string;
  usadoEm?: string;
  usadoNaLoja?: string;
}

export type TipoCampanha =
  | "cashback_creditado"
  | "cashback_vencendo"
  | "aniversario"
  | "reativacao"
  | "pos_venda"
  | "boas_vindas"
  | "avulsa";

export const CAMPANHAS: { id: TipoCampanha; nome: string; dica: string; marketing: boolean }[] = [
  { id: "boas_vindas", nome: "Boas-vindas", dica: "Cadastro novo na loja", marketing: false },
  { id: "cashback_creditado", nome: "Cashback creditado", dica: "No dia seguinte à compra", marketing: false },
  { id: "cashback_vencendo", nome: "Cashback vencendo", dica: "Dias antes de expirar", marketing: false },
  { id: "aniversario", nome: "Aniversário", dica: "No dia do aniversário", marketing: true },
  { id: "pos_venda", nome: "Pós-venda", dica: "Alguns dias depois da compra", marketing: false },
  { id: "reativacao", nome: "Reativação", dica: "Boa cliente sem comprar há meses", marketing: true },
  { id: "avulsa", nome: "Avulsa", dica: "Mandada à mão para um segmento", marketing: true },
];

export type StatusMensagem = "fila" | "enviando" | "enviada" | "entregue" | "lida" | "respondida" | "erro" | "cancelada";

export interface Mensagem {
  id: string;
  clienteId: string;
  telefone: string;
  campanha: TipoCampanha;
  /** Loja cujo número vai mandar */
  loja: string;
  texto: string;
  status: StatusMensagem;
  /** Não mandar antes disto (ISO) */
  naoAntesDe: string;
  criadoEm: string;
  enviadoEm?: string;
  /** Id da mensagem no WhatsApp, para casar com o status do webhook */
  idExterno?: string;
  erro?: string;
  tentativas: number;
  /** Primeira resposta da cliente depois desta mensagem */
  resposta?: string;
  respondidoEm?: string;
  /** Chave que impede a mesma automação de gerar a mesma mensagem duas vezes */
  chave?: string;
  /** Marketing: já contou (ou não) como "sem resposta" para a cliente */
  avaliada?: boolean;
}

/** Resposta recebida pelo webhook (fica no histórico mesmo sem mensagem nossa antes). */
export interface Recebida {
  id: string;
  telefone: string;
  clienteId?: string;
  loja?: string;
  texto: string;
  recebidoEm: string;
}

/** Uma mensagem trocada entre uma loja e uma cliente, para medir o atendimento. */
export interface Atendimento {
  loja: string;
  telefone: string;
  /** Quem mandou */
  de: "cliente" | "loja";
  /** ISO */
  em: string;
  /** Só das clientes, para a lista de pendentes */
  texto?: string;
}

/** Variações de texto de uma campanha. {nome}, {valor}, {loja}, {validade}, {codigo}, {primeiro} */
export interface Modelo {
  campanha: TipoCampanha;
  ativo: boolean;
  variacoes: string[];
}

export interface NumeroWhatsapp {
  loja: string;
  /** sessionId na WA-AKG (ou phone_number_id na Cloud API) */
  sessao: string;
  ativo: boolean;
  /** Teto diário deste número; sobrepõe o geral */
  tetoDia?: number;
}

export interface ConfigCrm {
  /** Percentual de cashback sobre a compra (ex.: 5) */
  cashbackPct: number;
  /** Validade do crédito em dias */
  cashbackValidadeDias: number;
  /** Valor mínimo de compra para gerar crédito */
  cashbackCompraMinima: number;
  /** Só pode resgatar se o saldo for pelo menos isto */
  cashbackResgateMinimo: number;
  /** Compras no site (Shopify) também geram cashback para usar na loja */
  cashbackSite: boolean;
  /** Clientes que só compraram no site entram nas automações (aniversário, reativação, pós-venda) */
  siteNasAutomacoes: boolean;
  /** Máximo do valor da compra que pode ser pago com cashback (0 a 100) */
  cashbackMaxPctDaCompra: number;
  /** Dias antes do vencimento para avisar */
  avisoVencimentoDias: number;
  /** Dias depois da compra para o pós-venda */
  posVendaDias: number;
  /** Reativação: sem comprar há X dias e ticket acumulado acima de Y */
  reativacaoDias: number;
  reativacaoTicketMinimo: number;
  /** Depois de uma reativação, esperar isto antes de outra para a mesma cliente */
  reativacaoIntervaloDias: number;

  /** Provedor de envio */
  provedor: "waakg" | "cloudapi" | "nenhum";
  waakgUrl?: string;
  waakgApiKey?: string;
  cloudApiToken?: string;
  /** Segredo que o webhook precisa trazer na URL (?t=) */
  webhookSegredo: string;
  numeros: NumeroWhatsapp[];
  /** Horário de envio (hora cheia, SP) */
  envioInicio: number;
  envioFim: number;
  /** Dias da semana que manda: 0 dom … 6 sáb */
  envioDias: number[];
  /** Teto diário por número */
  tetoDiaPorNumero: number;
  /** Intervalo entre mensagens do mesmo número, em segundos */
  intervaloMinSeg: number;
  intervaloMaxSeg: number;
  /** Campanhas de marketing seguidas sem resposta até parar de mandar marketing */
  maxSemResposta: number;
  /** Hora (SP) em que as automações do dia são geradas */
  horaAutomacoes: string;
  /** Pausa geral: nada sai da fila */
  pausado: boolean;
  /** Último dia em que as automações rodaram (YYYY-MM-DD) */
  ultimaAutomacao?: string;
  /** Última sincronização com o TOTVS */
  ultimaSincTotvs?: string;
  ultimaSincTotvsResultado?: string;
  /** Até onde as vendas já foram importadas do TOTVS (YYYY-MM-DD) */
  sincVendasDesde?: string;
  ultimaSincShopify?: string;
  ultimaSincShopifyResultado?: string;
  sincShopifyDesde?: string;
  backupDir?: string;
  migracoes?: string[];
}

export interface BaseCrm {
  versao: number;
  clientes: Cliente[];
  vendas: Venda[];
  cashback: MovimentoCashback[];
  codigos: CodigoResgate[];
  mensagens: Mensagem[];
  recebidas: Recebida[];
  atendimento: Atendimento[];
  modelos: Modelo[];
  config: ConfigCrm;
}

/** Cliente como a tela vê: com os números já calculados. */
export interface ClienteResumo extends Cliente {
  saldo: number;
  /** Crédito que vence nos próximos dias (soma e data mais próxima) */
  vencendo: number;
  vencendoEm?: string;
  totalGasto: number;
  compras: number;
  ultimaCompra?: string;
  ultimaLoja?: string;
  ultimaMensagem?: string;
  podeMarketing: boolean;
}

export const MODELOS_PADRAO: Modelo[] = [
  {
    campanha: "boas_vindas",
    ativo: true,
    variacoes: [
      "Oi {primeiro}, aqui é da Via Sol {loja}! Seu cadastro ficou pronto. A partir de agora toda compra gera cashback pra usar na próxima. Qualquer coisa é só responder aqui.",
      "{primeiro}, tudo bem? Via Sol {loja} aqui. Cadastro feito! Suas compras agora rendem cashback. Se precisar de algo, me chama por aqui.",
    ],
  },
  {
    campanha: "cashback_creditado",
    ativo: true,
    variacoes: [
      "Oi {primeiro}! Obrigada pela compra na Via Sol {loja}. Entrou {valor} de cashback pra você, vale até {validade}. É só mostrar essa mensagem no caixa quando vier usar.",
      "{primeiro}, sua compra na Via Sol {loja} gerou {valor} de cashback! Fica disponível até {validade}. Quando quiser usar, é só avisar a gente na loja.",
    ],
  },
  {
    campanha: "cashback_vencendo",
    ativo: true,
    variacoes: [
      "Oi {primeiro}, passando pra lembrar: você tem {valor} de cashback na Via Sol {loja} que vence em {validade}. Dá tempo de usar!",
      "{primeiro}, seu cashback de {valor} na Via Sol vence dia {validade}. Se quiser, me fala que eu separo alguma coisa pra você na loja {loja}.",
    ],
  },
  {
    campanha: "aniversario",
    ativo: true,
    variacoes: [
      "Feliz aniversário, {primeiro}! Aqui é da Via Sol {loja}. Pra comemorar, esse mês você tem um presente esperando na loja. Passa aqui pra gente te entregar.",
      "{primeiro}, parabéns pelo seu dia! A equipe da Via Sol {loja} te deseja um ano lindo. Tem um mimo de aniversário guardado pra você aqui na loja.",
    ],
  },
  {
    campanha: "pos_venda",
    ativo: false,
    variacoes: [
      "Oi {primeiro}, tudo bem? Como foi com as peças da Via Sol {loja}? Se precisar trocar tamanho ou tiver qualquer dúvida, é só me responder aqui.",
    ],
  },
  {
    campanha: "reativacao",
    ativo: true,
    variacoes: [
      "Oi {primeiro}, aqui é da Via Sol {loja}. Faz um tempo que você não aparece e a coleção nova chegou. Separo algumas peças do seu estilo pra você vir ver?",
      "{primeiro}, saudades! Via Sol {loja} aqui. Chegaram modelos novos que têm a sua cara. Quer que eu mande fotos ou prefere passar na loja?",
    ],
  },
  { campanha: "avulsa", ativo: true, variacoes: [] },
];

export const CONFIG_PADRAO: Omit<ConfigCrm, "webhookSegredo"> = {
  cashbackPct: 5,
  cashbackValidadeDias: 60,
  cashbackCompraMinima: 0,
  cashbackResgateMinimo: 20,
  cashbackSite: false,
  siteNasAutomacoes: false,
  cashbackMaxPctDaCompra: 30,
  avisoVencimentoDias: 7,
  posVendaDias: 5,
  reativacaoDias: 90,
  reativacaoTicketMinimo: 1000,
  reativacaoIntervaloDias: 180,
  provedor: "nenhum",
  numeros: [],
  envioInicio: 9,
  envioFim: 19,
  envioDias: [1, 2, 3, 4, 5, 6],
  tetoDiaPorNumero: 20,
  intervaloMinSeg: 60,
  intervaloMaxSeg: 240,
  maxSemResposta: 2,
  horaAutomacoes: "09:12",
  pausado: false,
};
