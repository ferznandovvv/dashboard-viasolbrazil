/**
 * Tipos do financeiro. Ficam separados do acesso a disco para a tela (cliente)
 * poder importar os rótulos sem levar `fs` junto.
 */

/** Onde cada despesa entra no DRE. */
export type GrupoDre =
  | "deducoes"
  | "cmv"
  | "pessoal"
  | "ocupacao"
  | "marketing"
  | "administrativas"
  | "financeiras"
  | "investimentos"
  | "retiradas";

export const GRUPOS: { id: GrupoDre; nome: string; dica: string }[] = [
  { id: "deducoes", nome: "Deduções da receita", dica: "Impostos sobre venda, taxas de cartão e de marketplace" },
  { id: "cmv", nome: "Custo da mercadoria (CMV)", dica: "Compra de mercadoria e frete de compra" },
  { id: "pessoal", nome: "Pessoal", dica: "Salários, comissões, encargos, benefícios" },
  { id: "ocupacao", nome: "Ocupação", dica: "Aluguel, condomínio, energia, água, internet" },
  { id: "marketing", nome: "Marketing", dica: "Anúncios, influenciadoras, material" },
  { id: "administrativas", nome: "Administrativas", dica: "Contador, sistemas, manutenção, frete de venda" },
  { id: "financeiras", nome: "Financeiras", dica: "Juros, tarifas bancárias, IOF" },
  { id: "investimentos", nome: "Investimentos", dica: "Equipamentos, reforma, obra — fora do resultado" },
  { id: "retiradas", nome: "Retiradas dos sócios", dica: "Distribuição de lucro — fora do resultado" },
];

export interface Empresa {
  id: string;
  nome: string;
  cnpj?: string;
  /** Lojas e canais cuja venda entra como receita desta empresa */
  unidades: string[];
  ativa: boolean;
}

export interface Categoria {
  id: string;
  nome: string;
  grupo: GrupoDre;
  ativa: boolean;
}

export type Papel = "admin" | "equipe";

export interface Usuario {
  id: string;
  nome: string;
  login: string;
  hash: string;
  salt: string;
  papel: Papel;
  /** Equipe só vê o DRE se o admin liberar */
  veDre: boolean;
  ativo: boolean;
  criadoEm: string;
}

/** O que a tela recebe de um usuário — nunca o hash da senha. */
export type UsuarioPublico = Omit<Usuario, "hash" | "salt">;

export const FORMAS = ["Boleto", "PIX", "Cartão de crédito", "Transferência", "Débito automático", "Dinheiro"];

/** Parte de uma conta dividida entre lojas (valor em R$, somando o valor da conta). */
export interface ParteRateio {
  unidade: string;
  valor: number;
}

export interface Anexo {
  id: string;
  /** Nome original do arquivo */
  nome: string;
  tipo: string;
  tamanho: number;
}

export interface Conta {
  id: string;
  descricao: string;
  fornecedor: string;
  empresaId: string;
  categoriaId: string;
  valor: number;
  /** YYYY-MM-DD */
  vencimento: string;
  /** Mês a que a despesa se refere (YYYY-MM) — é o que conta no DRE por competência */
  competencia: string;
  forma: string;
  /** "2/5" quando faz parte de um parcelamento */
  parcela?: string;
  /** Liga as parcelas/repetições lançadas juntas */
  lote?: string;
  observacao: string;
  /**
   * Lojas que pagam esta conta. Uma loja só = conta daquela loja; várias =
   * rateio. Vazio = despesa geral da empresa, sem loja.
   */
  rateio?: ParteRateio[];
  /** Boleto, nota, comprovante de pagamento */
  anexos?: Anexo[];
  status: "aberta" | "paga";
  pagoEm?: string;
  valorPago?: number;
  criadoPor: string;
  criadoEm: string;
  pagoPor?: string;
  alteradoEm?: string;
}

/** Um lançamento anterior, usado para completar o formulário. */
export interface Sugestao {
  fornecedor: string;
  descricao: string;
  empresaId: string;
  categoriaId: string;
  forma: string;
  valor: number;
  rateio?: ParteRateio[];
  /** Vencimento do último lançamento assim */
  em: string;
  /** Quantas vezes já foi lançado */
  vezes: number;
}

export interface BaseFinanceira {
  versao: 1;
  empresas: Empresa[];
  categorias: Categoria[];
  usuarios: Usuario[];
  contas: Conta[];
  config: {
    /** Pasta do Google Drive/OneDrive onde vai a cópia de segurança */
    backupDir?: string;
    /** Assina o cookie de sessão */
    segredo: string;
    /** Ajustes automáticos já aplicados nesta base */
    migracoes?: string[];
  };
}

/** Uma linha do DRE, como a tela recebe. */
export interface LinhaDre {
  chave: string;
  rotulo: string;
  /** receita, grupo de despesa, categoria (dentro de um grupo), subtotal ou percentual */
  tipo: "receita" | "grupo" | "categoria" | "subtotal" | "margem";
  grupo?: GrupoDre;
  valores: number[];
  total: number;
}

/** Plano de contas inicial — dá para editar e criar mais na tela. */
export const CATEGORIAS_PADRAO: [string, GrupoDre][] = [
  ["Impostos (Simples / ICMS)", "deducoes"],
  ["Taxa de cartão / maquininha", "deducoes"],
  ["Taxa de marketplace (TikTok, ML)", "deducoes"],
  ["Compra de mercadoria", "cmv"],
  ["Frete de compra", "cmv"],
  ["Salários", "pessoal"],
  ["Comissões", "pessoal"],
  ["Encargos (INSS, FGTS)", "pessoal"],
  ["Vale transporte / refeição", "pessoal"],
  ["Pró-labore", "pessoal"],
  ["Aluguel", "ocupacao"],
  ["Condomínio", "ocupacao"],
  ["Energia", "ocupacao"],
  ["Água", "ocupacao"],
  ["Internet / telefone", "ocupacao"],
  ["IPTU", "ocupacao"],
  ["Anúncios (Meta, TikTok, Google)", "marketing"],
  ["Influenciadoras", "marketing"],
  ["Material de marketing", "marketing"],
  ["Contabilidade", "administrativas"],
  ["Sistemas (TOTVS, Shopify…)", "administrativas"],
  ["Material de escritório / limpeza", "administrativas"],
  ["Manutenção", "administrativas"],
  ["Frete de venda / Correios", "administrativas"],
  ["Tarifas bancárias", "financeiras"],
  ["Juros e multas", "financeiras"],
  ["Equipamentos", "investimentos"],
  ["Reforma / obra", "investimentos"],
  ["Distribuição de lucro", "retiradas"],
];

/** Some 1 mês de um YYYY-MM-DD ou YYYY-MM, segurando o dia no fim do mês. */
export function somarMeses(data: string, n: number): string {
  const [y, m, d] = data.split("-").map(Number);
  const alvo = new Date(Date.UTC(y, m - 1 + n, 1));
  const ano = alvo.getUTCFullYear();
  const mes = alvo.getUTCMonth() + 1;
  const pad = (v: number) => String(v).padStart(2, "0");
  if (!d) return `${ano}-${pad(mes)}`;
  const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  return `${ano}-${pad(mes)}-${pad(Math.min(d, ultimo))}`;
}
