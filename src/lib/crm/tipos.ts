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
  /** Cidade e UF, quando conhecidas (endereço de entrega do site) */
  cidade?: string;
  uf?: string;
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
  /** CPF da vendedora que registrou a venda no PDV (só dígitos) */
  vendedoraCpf?: string;
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

/**
 * Código que a cliente mostra no caixa, uma vez só. Pode ser de cashback
 * (valor) ou de uma oferta de campanha (aniversário, reativação), e guarda
 * de qual campanha e mensagem veio: é isso que mede o que trouxe a cliente.
 */
export interface CodigoResgate {
  codigo: string;
  clienteId: string;
  /** Cashback a usar (0 quando é oferta) */
  valor: number;
  /** Oferta da campanha (ex.: "10% de desconto"), quando não é cashback */
  oferta?: string;
  campanha?: TipoCampanha;
  mensagemId?: string;
  criadoEm: string;
  /** YYYY-MM-DD */
  validade: string;
  usadoEm?: string;
  usadoNaLoja?: string;
  /** Valor da compra em que foi usado, para medir o retorno */
  compraValor?: number;
}

export type TipoCampanha =
  | "cashback_creditado"
  | "cashback_site_perto"
  | "cashback_site_longe"
  | "cashback_vencendo"
  | "cashback_vencendo_urgente"
  | "aniversario"
  | "reativacao"
  | "pos_venda"
  | "boas_vindas"
  | "avulsa";

export const CAMPANHAS: { id: TipoCampanha; nome: string; dica: string; marketing: boolean }[] = [
  { id: "boas_vindas", nome: "Boas-vindas", dica: "Cadastro novo na loja", marketing: false },
  { id: "cashback_creditado", nome: "Cashback creditado (loja)", dica: "No dia seguinte à compra na loja", marketing: false },
  { id: "cashback_site_perto", nome: "Cashback creditado (site, tem loja na cidade)", dica: "Compra no site de quem mora numa cidade com loja", marketing: false },
  { id: "cashback_site_longe", nome: "Cashback creditado (site, sem loja perto)", dica: "Compra no site de quem mora longe das lojas", marketing: false },
  { id: "cashback_vencendo", nome: "Cashback vencendo (primeiro aviso)", dica: "Alguns dias antes de expirar", marketing: false },
  { id: "cashback_vencendo_urgente", nome: "Cashback vencendo (último aviso)", dica: "Poucos dias antes, com urgência", marketing: false },
  { id: "aniversario", nome: "Aniversário", dica: "No dia, com a oferta configurada", marketing: true },
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
  /** Quem assina as mensagens dessa loja quando a venda não tem vendedora (ex.: "Carol") */
  vendedora?: string;
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
  /** Máximo do valor da compra que pode ser pago com cashback (0 a 100). Usado só se o múltiplo for 0 */
  cashbackMaxPctDaCompra: number;
  /** A compra precisa ser pelo menos N vezes o cashback usado (3 = cashback paga no máximo 1/3) */
  cashbackMultiploCompra: number;
  /** Dias antes do vencimento para o primeiro aviso */
  avisoVencimentoDias: number;
  /** Dias antes do vencimento para o último aviso, com urgência */
  avisoVencimentoUrgenteDias: number;
  /** O que a aniversariante ganha (vai no texto como {oferta}) */
  aniversarioOferta: string;
  /** Quando mandar: no começo do mês (ela tem o mês todo) ou no dia */
  aniversarioQuando: "inicio_mes" | "dia";
  /** Reativação: pelo total gasto, o que oferecer. Vale a maior faixa atingida */
  reativacaoFaixas: { minimo: number; oferta: string }[];
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
  /** Modo sombra: as automações geram as mensagens, mas nada é enviado; serve para ler o que sairia */
  modoSombra: boolean;
  /** Máximo de mensagens por cliente em 30 dias, de qualquer campanha (aviso de cashback da própria compra não conta) */
  maxMensagensMes: number;
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
  /** Nome da vendedora por CPF (vem do cadastro de pessoa do TOTVS) */
  vendedoras: Record<string, string>;
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

/** Cidade de cada loja, para avisar a cliente do site que tem loja perto dela. */
export const LOJA_CIDADE: Record<string, string> = {
  Centro: "Franca",
  Fiusa: "Franca",
  "Loja de Fábrica": "Franca",
  "Rio de Janeiro": "Rio de Janeiro",
  "Ribeirão Preto": "Ribeirão Preto",
  "SP — Itaim": "São Paulo",
  "Belo Horizonte": "Belo Horizonte",
  "Praia Grande": "Praia Grande",
};

export const MODELOS_PADRAO: Modelo[] = [
  {
    campanha: "boas_vindas",
    ativo: false,
    variacoes: [
      "Oi {primeiro}, aqui é a {vendedora}, da Via Sol {loja} ☀️ Seu cadastro ficou pronto, e a partir de agora cada compra sua rende cashback pra próxima. Qualquer coisa, me chama por aqui.",
    ],
  },
  {
    campanha: "cashback_creditado",
    ativo: true,
    variacoes: [
      "Oi {primeiro}, tudo bem? Aqui é a {vendedora}, da Via Sol {loja} ☀️ Sua compra de ontem rendeu {valor} de cashback, que fica guardado no seu nome até {validade}. Pra usar, a compra precisa ser pelo menos {compraMinima}. Quando quiser vir, me avisa que eu te recebo.",
      "{primeiro}, obrigada pela visita ontem! 🧡 Aqui é a {vendedora}, da Via Sol {loja}. Ficou {valor} de cashback no seu nome, pra usar até {validade} numa compra a partir de {compraMinima}. Quando chegar peça nova eu te mando foto, pode ser?",
      "Oi {primeiro}! {vendedora} aqui, da Via Sol {loja} 👙 Entrou {valor} de cashback pra você, válido até {validade} em qualquer loja nossa (vale em compra a partir de {compraMinima}). Adorei te atender, volta logo.",
    ],
  },
  {
    campanha: "cashback_site_perto",
    ativo: true,
    variacoes: [
      "Oi {primeiro}, aqui é a {vendedora}, da Via Sol {lojaProxima} ☀️ Vi que você comprou no nosso site e queria te contar: essa compra rendeu {valor} de cashback pra usar na loja, até {validade}, em compra a partir de {compraMinima}. A gente fica em {cidade}, então quando quiser experimentar ao vivo é só me chamar.",
      "{primeiro}, tudo bem? Sou a {vendedora}, da Via Sol aqui de {cidade} 🧡 Sua compra no site gerou {valor} de cashback, válido até {validade} na nossa loja {lojaProxima} (em compra a partir de {compraMinima}). Se quiser, separo peças do seu tamanho pra você provar.",
    ],
  },
  {
    campanha: "cashback_site_longe",
    ativo: true,
    variacoes: [
      "Oi {primeiro}, aqui é a {vendedora}, da Via Sol ☀️ Sua compra no site rendeu {valor} de cashback, válido até {validade} em qualquer loja nossa (Franca, Ribeirão Preto, São Paulo, Rio de Janeiro, Belo Horizonte e Praia Grande), em compra a partir de {compraMinima}. Se passar por alguma delas, me avisa que eu deixo tudo preparado.",
    ],
  },
  {
    campanha: "cashback_vencendo",
    ativo: true,
    variacoes: [
      "Oi {primeiro}, {vendedora} aqui, da Via Sol {loja} ☀️ Lembra do seu cashback de {valor}? Ele vence em {validade}. Chegaram peças novas essa semana, quer que eu te mande umas fotos pra você escolher com calma?",
      "{primeiro}, tudo bem? Passando pra lembrar que você tem {valor} de cashback aqui na Via Sol {loja}, válido até {validade} 🧡 Quer que eu separe algo do seu tamanho pra você vir ver?",
    ],
  },
  {
    campanha: "cashback_vencendo_urgente",
    ativo: true,
    variacoes: [
      "{primeiro}, é a {vendedora} 🧡 Seu cashback de {valor} vence em {validade}, daqui a pouquinho. Não queria que você perdesse. Se não der pra passar na loja, me responde que eu vejo um jeito de te ajudar a usar.",
      "Oi {primeiro}! Último lembrete da {vendedora}: {valor} de cashback no seu nome vencendo dia {validade} ☀️ Dá tempo de usar ainda, te espero na Via Sol {loja}.",
    ],
  },
  {
    campanha: "aniversario",
    ativo: true,
    variacoes: [
      "{primeiro}, mês do seu aniversário chegou! 🎉 Aqui é a {vendedora}, da Via Sol {loja}. Pra comemorar, durante todo o mês você tem {oferta} em qualquer peça da loja. É só falar o código {codigo} no caixa. Te espero!",
      "Oi {primeiro}, é a {vendedora}, da Via Sol {loja} ☀️ Esse mês é o seu, então separei um presente: {oferta} em qualquer compra até o fim do mês. Seu código é {codigo}, é só mostrar pra gente no caixa. Feliz aniversário adiantado!",
    ],
  },
  {
    campanha: "pos_venda",
    ativo: false,
    variacoes: [
      "Oi {primeiro}, tudo bem? {vendedora} aqui, da Via Sol {loja}. Como ficaram as peças? Se precisar trocar tamanho ou tiver qualquer dúvida, é só me responder.",
    ],
  },
  {
    campanha: "reativacao",
    ativo: false,
    variacoes: [
      "Oi {primeiro}, aqui é a {vendedora}, da Via Sol {loja} ☀️ Faz um tempinho que você não aparece e eu lembrei de você porque chegou coleção nova. Como você é cliente nossa de verdade, separei {oferta} pra sua próxima compra (código {codigo}). Quer que eu mande fotos ou prefere passar aqui?",
      "{primeiro}, saudades! 🧡 {vendedora}, da Via Sol {loja}. Chegaram modelos novos que têm muito a sua cara. Pra te ver de novo por aqui, você tem {oferta} esperando, é só falar o código {codigo} no caixa. Me avisa quando puder vir.",
    ],
  },
  { campanha: "avulsa", ativo: true, variacoes: [] },
];

export const CONFIG_PADRAO: Omit<ConfigCrm, "webhookSegredo"> = {
  cashbackPct: 15,
  cashbackValidadeDias: 90,
  cashbackCompraMinima: 0,
  cashbackResgateMinimo: 0,
  cashbackSite: true,
  siteNasAutomacoes: false,
  cashbackMaxPctDaCompra: 0,
  cashbackMultiploCompra: 3,
  avisoVencimentoDias: 10,
  avisoVencimentoUrgenteDias: 2,
  aniversarioOferta: "10% de desconto",
  aniversarioQuando: "inicio_mes",
  reativacaoFaixas: [
    { minimo: 500, oferta: "10% de desconto" },
    { minimo: 1000, oferta: "um presente surpresa" },
  ],
  posVendaDias: 5,
  reativacaoDias: 90,
  reativacaoTicketMinimo: 500,
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
  modoSombra: true,
  maxMensagensMes: 2,
};
