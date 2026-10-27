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
  /** Liga a sessão parada (STOPPED). Desconectada (LOGGED_OUT) precisa ler o QR de novo. */
  iniciar?(sessao: string): Promise<{ ok: boolean; detalhe: string }>;
  /** Número do próprio WhatsApp da sessão (só dígitos), se o provedor souber */
  meuNumero?(sessao: string): Promise<string | undefined>;
  /** Nome legível da sessão a partir do código que vem no webhook (quando o provedor tem os dois). */
  nomeDaSessao?(codigo: string): Promise<string | undefined>;
  /** Contatos do número (dígitos do telefone ou do id → nome salvo / nome do WhatsApp) */
  contatos?(sessao: string): Promise<Map<string, string>>;
  /** Garante que o provedor avisa o CRM das mensagens desse número (cria o webhook se faltar) */
  garantirWebhook?(sessao: string, url: string): Promise<{ ok: boolean; detalhe: string }>;
  /** Mensagens das conversas (sem grupos) com movimento desde `desde` (ISO): para completar o que o aviso perdeu */
  conversasRecentes?(sessao: string, desde: string): Promise<MensagemRecuperada[]>;
}

export interface MensagemRecuperada {
  /** Conversa (telefone@s.whatsapp.net ou id@lid) */
  jid: string;
  /** Código da mensagem no WhatsApp */
  id: string;
  fromMe: boolean;
  /** TEXT, IMAGE, AUDIO... */
  tipo: string;
  conteudo: string;
  /** ISO */
  em: string;
  nome?: string;
}

export function adaptadorDe(cfg: ConfigCrm): Adaptador | null {
  if (cfg.provedor === "waakg" && cfg.waakgUrl && cfg.waakgApiKey) return new WaAkg(cfg.waakgUrl, cfg.waakgApiKey);
  if (cfg.provedor === "cloudapi" && cfg.cloudApiToken) return new CloudApi(cfg.cloudApiToken);
  return null;
}
