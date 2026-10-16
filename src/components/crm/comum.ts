/** Peças comuns às telas do CRM. */

import type { ClienteResumo, ConfigCrm, Mensagem, Modelo, StatusMensagem, TipoCampanha } from "@/lib/crm/tipos";

export { api, brl, dataBr, hojeSp, lerValor } from "@/components/financeiro/comum";

export const dataBrAno = (d?: string) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : "");
export const dataHora = (iso?: string) =>
  iso ? new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";

export const STATUS_NOME: Record<StatusMensagem, string> = {
  fila: "na fila",
  enviando: "enviando",
  enviada: "enviada",
  entregue: "entregue",
  lida: "lida",
  respondida: "respondida",
  erro: "erro",
  cancelada: "cancelada",
};

export interface Resumo {
  local: boolean;
  hoje: string;
  lojas: string[];
  totvs: { configurado: boolean; ultima?: string; resultado?: string; desde?: string; progresso: Progresso };
  base: { clientes: number; comTelefone: number; vendas: number; saldoTotal: number };
  fila: { emEspera: number; enviadasMes: number; respondidasMes: number; errosSemana: number; pausado: boolean; dentroDaJanela: boolean; provedor: string | null };
  numeros: { loja: string; sessao: string; ativo: boolean; hoje: number; teto: number; situacao: { conectado: boolean; detalhe?: string } | null }[];
  segmentos: { id: string; nome: string; dica: string; total: number }[];
  ultimaAutomacao?: string;
}

export interface Progresso {
  rodando: boolean;
  etapa: string;
  inicio?: number;
  vendasNovas: number;
  clientesNovos: number;
  clientesAtualizados: number;
  erro?: string;
  fim?: number;
}

export interface DadosConfig {
  config: ConfigCrm;
  temWaakgApiKey: boolean;
  temCloudApiToken: boolean;
  modelos: Modelo[];
  campanhas: { id: TipoCampanha; nome: string; dica: string; marketing: boolean }[];
  lojas: string[];
  webhookUrl: string;
}

export type MensagemComCliente = Mensagem & { cliente: string };
export type { ClienteResumo };
