/**
 * Envio por número, para a tela principal do CRM: quanto cada número já
 * mandou hoje perto do teto, quanto espera na fila (e em quantos dias zera)
 * e os sinais de risco de bloqueio (SAIR, erro) dos últimos 7 dias.
 */

import { hojeSp } from "./base";
import { enviadasHoje } from "./fila";
import { LOJA_OFICIAL, tetoDoNumero, type BaseCrm, type Mensagem } from "./tipos";

export interface LinhaEnvio {
  loja: string;
  provedor: "waakg" | "oficial";
  ativo: boolean;
  /** Ligado, mas descansando até este dia */
  ligarEm?: string;
  /** Enviadas hoje e o teto do dia */
  hoje: number;
  teto: number;
  /** Em modo sombra: quantas teriam saído hoje (pra ver se o teto aguenta antes de ligar) */
  simuladasHoje: number;
  naFila: number;
  /** Dias para a fila zerar no ritmo do teto (0 = sai hoje) */
  filaDias: number;
  enviadas7d: number;
  respondidas7d: number;
  pctResposta: number | null;
  /** Pediram para sair, pelo número, nos últimos 7 dias */
  sair7d: number;
  erros7d: number;
}

const ENVIADA: Mensagem["status"][] = ["enviada", "entregue", "lida", "respondida"];

export function envioPorNumero(base: BaseCrm): LinhaEnvio[] {
  const cfg = base.config;
  const hoje = hojeSp();
  const desde7 = new Date(Date.now() - 7 * 86400000).toISOString();
  const lojas = [
    ...cfg.numeros.filter((n) => n.sessao).map((n) => ({ loja: n.loja, provedor: "waakg" as const, ativo: n.ativo, ligarEm: n.ligarEm && hoje < n.ligarEm ? n.ligarEm : undefined, teto: tetoDoNumero(cfg, n, hoje) })),
    ...(cfg.oficial?.phoneNumberId || cfg.oficial?.campanhas?.length
      ? [{ loja: LOJA_OFICIAL, provedor: "oficial" as const, ativo: Boolean(cfg.oficial?.phoneNumberId && cfg.oficial?.token), teto: cfg.oficial?.tetoDia ?? 250 }]
      : []),
  ];
  const sairPorLoja = new Map<string, number>();
  for (const x of Object.values(base.naoContatar ?? {})) if (x.loja && x.em >= desde7) sairPorLoja.set(x.loja, (sairPorLoja.get(x.loja) ?? 0) + 1);

  return lojas.map((l) => {
    const doNumero = (m: Mensagem) => (l.provedor === "oficial" ? m.provedor === "oficial" : m.loja === l.loja && m.provedor !== "oficial");
    let simuladasHoje = 0;
    let naFila = 0;
    let enviadas7d = 0;
    let respondidas7d = 0;
    let erros7d = 0;
    for (const m of base.mensagens) {
      if (!doNumero(m)) continue;
      if (m.status === "fila" || m.status === "enviando") naFila++;
      if (m.status === "simulada" && m.criadoEm.startsWith(hoje)) simuladasHoje++;
      if (m.enviadoEm && m.enviadoEm >= desde7 && ENVIADA.includes(m.status)) {
        enviadas7d++;
        if (m.status === "respondida") respondidas7d++;
      }
      if (m.status === "erro" && m.criadoEm >= desde7) erros7d++;
    }
    const hojeN = l.provedor === "oficial" ? base.mensagens.filter((m) => m.provedor === "oficial" && m.enviadoEm?.startsWith(hoje) && ENVIADA.includes(m.status)).length : enviadasHoje(base, l.loja, hoje);
    const sobraHoje = Math.max(0, l.teto - hojeN);
    return {
      ...l,
      hoje: hojeN,
      simuladasHoje,
      naFila,
      filaDias: naFila <= sobraHoje ? 0 : Math.ceil((naFila - sobraHoje) / Math.max(1, l.teto)),
      enviadas7d,
      respondidas7d,
      pctResposta: enviadas7d ? Math.round((respondidas7d / enviadas7d) * 100) : null,
      sair7d: sairPorLoja.get(l.loja) ?? 0,
      erros7d,
    };
  });
}
