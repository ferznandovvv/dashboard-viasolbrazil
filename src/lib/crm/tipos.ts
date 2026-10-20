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
  /** Desconto dado na nota (R$), quando a nota veio com os itens */
  desconto?: number;
  /** A nota tem frete de motoboy/entrega (venda à distância), quando veio com os itens */
  entrega?: boolean;
  /** Referências dos produtos da nota (código do item), quando veio com os itens: liga a devolução à compra certa */
  itens?: string[];
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
  /** Estorno por devolução ou nota cancelada: id do registro em `devolucoes` */
  devolucaoId?: string;
}

/**
 * Devolução (nota de entrada de devolução de venda) ou venda cancelada na
 * TOTVS, e quanto de cashback saiu por causa dela. Fica registrada mesmo
 * quando não tira nada, para não ser lida de novo e para o dono conferir.
 */
export interface Devolucao {
  /** Nota de entrada (filial-sequência) ou "cancelada-" + id da venda */
  id: string;
  tipo: "devolucao" | "cancelamento";
  loja: string;
  /** YYYY-MM-DD */
  data: string;
  valor: number;
  clienteId?: string;
  nomeNaNota?: string;
  /** Cashback tirado (R$, positivo) */
  estorno: number;
  /** Vendas de onde o cashback saiu */
  vendas?: string[];
  /** Por que não tirou nada, ou tirou menos */
  obs?: string;
  vistoEm: string;
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
  { id: "cashback_site_perto", nome: "Cashback creditado (site, tem loja na cidade)", dica: "Compra no site de quem mora numa cidade com loja: lembra que a loja existe e o endereço", marketing: false },
  { id: "cashback_site_longe", nome: "Cashback creditado (site, sem loja perto)", dica: "Compra no site de quem mora longe das lojas (desligada: só faz sentido pra quem pode ir na loja)", marketing: false },
  { id: "cashback_vencendo", nome: "Cashback vencendo (primeiro aviso)", dica: "Alguns dias antes de expirar", marketing: false },
  { id: "cashback_vencendo_urgente", nome: "Cashback vencendo (último aviso)", dica: "Poucos dias antes, com urgência", marketing: false },
  { id: "aniversario", nome: "Aniversário", dica: "No começo do mês do aniversário (ou no dia), com a oferta", marketing: true },
  { id: "pos_venda", nome: "Pós-venda", dica: "Alguns dias depois da compra", marketing: false },
  { id: "reativacao", nome: "Reativação", dica: "Boa cliente sem comprar há meses", marketing: true },
  { id: "avulsa", nome: "Avulsa", dica: "Mandada à mão para um segmento", marketing: true },
];

/** "simulada": gerada em modo sombra; nunca sai, nem quando o modo sombra é desligado. */
export type StatusMensagem = "fila" | "enviando" | "enviada" | "entregue" | "lida" | "respondida" | "erro" | "cancelada" | "simulada";

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
  /** Campanha manual (aba Campanhas) que gerou a mensagem */
  campanhaId?: string;
}

/** Faixas de cliente pelo histórico de compra (ver perfil.ts). */
export type FaixaCliente = "Ouro" | "Prata" | "Bronze" | "Nova" | "Parada" | "Sem compra";

export const FAIXAS: { id: FaixaCliente; dica: string }[] = [
  { id: "Ouro", dica: "3+ compras ou R$ 1.500+, comprou no último ano" },
  { id: "Prata", dica: "2 compras ou R$ 600+, comprou no último ano" },
  { id: "Bronze", dica: "1 compra entre 6 meses e 1 ano atrás" },
  { id: "Nova", dica: "1 compra nos últimos 6 meses" },
  { id: "Parada", dica: "Sem comprar há mais de um ano" },
  { id: "Sem compra", dica: "Cadastrada, sem compra registrada" },
];

/** Quem entra numa campanha manual. Campo vazio = não filtra. */
export interface FiltroCampanha {
  /** Loja da cliente (a da última compra, senão a do cadastro) */
  lojas: string[];
  faixas: FaixaCliente[];
  /** Sem comprar há pelo menos N dias */
  semComprarDias?: number;
  /** Comprou nos últimos N dias */
  compraramDias?: number;
  gastoMinimo?: number;
  comSaldo?: boolean;
  aniversariantes?: boolean;
  /** Máximo de clientes (as que mais gastaram primeiro) */
  limite?: number;
}

/** Campanha montada à mão na aba Campanhas, espalhada no tempo. */
export interface CampanhaManual {
  id: string;
  nome: string;
  criadaEm: string;
  filtro: FiltroCampanha;
  /** Variações do texto; cada cliente recebe uma, sorteada */
  variacoes: string[];
  /** Oferta com código único por cliente (vai em {oferta} e {codigo}) */
  oferta?: string;
  /** Primeira mensagem (ISO) */
  inicio: string;
  /** Em quantos minutos espalhar, por número */
  duracaoMin: number;
  total: number;
  puladas: Record<string, number>;
  /** Criada em modo sombra: só simulada */
  simulada?: boolean;
  canceladaEm?: string;
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
  /** Começo do texto: da cliente (lista de quem espera) e da loja (pra reconhecer mensagem automática) */
  texto?: string;
  /** Nome que a cliente usa no WhatsApp */
  nome?: string;
  /** Código da mensagem no WhatsApp: evita gravar a mesma duas vezes (aviso + busca) */
  id?: string;
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
  /** Endereço da loja, pra mensagem da cliente do site que mora na cidade (ex.: "Rua do Comércio, 1200") */
  endereco?: string;
  /** Horário de atendimento ("10:00-22:00"; vazio = fechado). Sem isso, vale o horário de envio, seg a sáb */
  horario?: { semana?: string; sabado?: string; domingo?: string };
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
  /** Link da WA-AKG para abrir no navegador (de fora de casa, pelo túnel). Vazio = usa o waakgUrl. */
  waakgLink?: string;
  waakgApiKey?: string;
  cloudApiToken?: string;
  /** Segredo que o webhook precisa trazer na URL (?t=) */
  webhookSegredo: string;
  /**
   * Endereço público do painel (https://…), usado no webhook da WA-AKG. Desde
   * a 1.7 ela só manda webhook para HTTPS público e recusa localhost. Vazio =
   * usa http://localhost (só serve até a 1.6). Sem valor = o padrão abaixo.
   */
  enderecoPublico?: string;
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
  /** Na primeira mensagem de cada cliente, uma linha explicando como sair */
  avisoSair: boolean;
  textoSair: string;
  /** Último dia em que as automações rodaram (YYYY-MM-DD) */
  ultimaAutomacao?: string;
  /** Última sincronização com o TOTVS */
  ultimaSincTotvs?: string;
  ultimaSincTotvsResultado?: string;
  /** Até onde as vendas já foram importadas do TOTVS (YYYY-MM-DD) */
  sincVendasDesde?: string;
  /** Último dia coberto pela sincronização automática do TOTVS, e quando ela terminou bem */
  diariaTotvsAte?: string;
  /** Até que dia as devoluções da TOTVS já foram conferidas (estorno de cashback) */
  devolucoesAte?: string;
  diariaTotvsEm?: string;
  ultimaSincShopify?: string;
  ultimaSincShopifyResultado?: string;
  sincShopifyDesde?: string;
  backupDir?: string;
  /** Já procurou o celular no endereço de todas as clientes do TOTVS */
  telefonesNoEndereco?: boolean;
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
  /**
   * Telefones que pediram para não receber mais (SAIR), cadastrados ou não:
   * vale para qualquer cliente com esse telefone, inclusive cadastrada depois.
   */
  naoContatar?: Record<string, { em: string; loja?: string; texto?: string }>;
  /** Devoluções e vendas canceladas já conferidas (estorno de cashback) */
  devolucoes?: Devolucao[];
  /** "Não precisa responder": loja|telefone → até quando (ISO) a espera foi dispensada */
  atendimentoIgnorado?: Record<string, string>;
  /** Nome da vendedora por CPF (vem do cadastro de pessoa do TOTVS) */
  vendedoras: Record<string, string>;
  modelos: Modelo[];
  campanhas: CampanhaManual[];
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
  faixa?: FaixaCliente;
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
      "Oi {primeiro}, tudo bem? Aqui é a {vendedora}, da Via Sol {loja} ☀️ Sua compra {daCompra} rendeu {valor} de cashback, que fica guardado no seu nome até {validade}. Pra usar, a compra precisa ser pelo menos {compraMinima}. Quando quiser vir, me avisa que eu te recebo.",
      "{primeiro}, obrigada pela visita {quando}! 🧡 Aqui é a {vendedora}, da Via Sol {loja}. Ficou {valor} de cashback no seu nome, pra usar até {validade} numa compra a partir de {compraMinima}. Quando chegar peça nova eu te mando foto, pode ser?",
      "Oi {primeiro}! {vendedora} aqui, da Via Sol {loja} 👙 Entrou {valor} de cashback pra você, válido até {validade} em qualquer loja nossa (vale em compra a partir de {compraMinima}). Adorei te atender, volta logo.",
    ],
  },
  {
    campanha: "cashback_site_perto",
    ativo: true,
    variacoes: [
      "Oi {primeiro}! Aqui é da Via Sol ☀️ Sua compra no nosso site rendeu {valor} de cashback, válido até {validade}. E lembrando: temos loja física aí em {cidade}{endereco}, e o seu cashback vale lá também, em compras a partir de {compraMinima}.",
      "{primeiro}, sua compra no site da Via Sol rendeu {valor} de cashback 🧡 Ele vale até {validade} e dá pra usar na nossa loja de {cidade}{endereco}, em compras a partir de {compraMinima}. Passa lá pra provar as peças ao vivo!",
    ],
  },
  {
    campanha: "cashback_site_longe",
    ativo: false,
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

/** Endereço público do painel pelo túnel do Cloudflare */
export const ENDERECO_PUBLICO_PADRAO = "https://painel.viasolbrazil.com.br";

/** Link público da WA-AKG pelo mesmo túnel (protegido pelo Cloudflare Access) */
export const WAAKG_LINK_PADRAO = "https://whats.viasolbrazil.com.br";

/** Endereço da WA-AKG para a pessoa abrir no navegador (botões "abrir conversas"). */
export function linkDaWaakg(config: Pick<ConfigCrm, "provedor" | "waakgUrl" | "waakgLink">): string | undefined {
  if (config.provedor !== "waakg") return undefined;
  const link = (config.waakgLink ?? WAAKG_LINK_PADRAO).trim().replace(/\/+$/, "");
  return link || config.waakgUrl || undefined;
}

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
  tetoDiaPorNumero: 50,
  intervaloMinSeg: 60,
  intervaloMaxSeg: 240,
  maxSemResposta: 2,
  horaAutomacoes: "09:12",
  pausado: false,
  modoSombra: true,
  maxMensagensMes: 2,
  avisoSair: true,
  textoSair: "Se preferir não receber mensagens nossas por aqui, é só responder SAIR.",
};
