/**
 * Camada de envio: o CRM fala com esta interface, nunca com o provedor
 * direto. Trocar WA-AKG pela API oficial é trocar o adaptador.
 */

import type { ConfigCrm } from "../tipos";
import { WaAkg } from "./waAkg";
import { CloudApi } from "./cloudApi";

export interface ResultadoEnvio {
  ok: boolean;
  /** Id da mensagem no WhatsApp, para casar com o status depois */
  idExterno?: string;
  erro?: string;
}

export interface SituacaoNumero {
  sessao: string;
  conectado: boolean;
  detalhe?: string;
}

export interface Adaptador {
  nome: string;
  /** `sessao` identifica o número (sessionId na WA-AKG, phone_number_id na Cloud API). */
  enviarTexto(sessao: string, telefone: string, texto: string): Promise<ResultadoEnvio>;
  situacao(sessao: string): Promise<SituacaoNumero>;
  /** Nome legível da sessão a partir do código que vem no webhook (quando o provedor tem os dois). */
  nomeDaSessao?(codigo: string): Promise<string | undefined>;
  /** Contatos do número (dígitos do telefone ou do id → nome salvo / nome do WhatsApp) */
  contatos?(sessao: string): Promise<Map<string, string>>;
}

export function adaptadorDe(cfg: ConfigCrm): Adaptador | null {
  if (cfg.provedor === "waakg" && cfg.waakgUrl && cfg.waakgApiKey) return new WaAkg(cfg.waakgUrl, cfg.waakgApiKey);
  if (cfg.provedor === "cloudapi" && cfg.cloudApiToken) return new CloudApi(cfg.cloudApiToken);
  return null;
}
