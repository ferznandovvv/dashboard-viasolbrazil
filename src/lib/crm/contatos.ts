/**
 * Nome pra mostrar de quem está esperando resposta: a cliente da base,
 * senão o contato salvo no celular da loja (pela WA-AKG), senão o nome que
 * ela usa no WhatsApp, senão o número.
 */

import { adaptadorDe } from "./envio/adaptador";
import type { Pendente } from "./atendimento";
import type { BaseCrm } from "./tipos";

export async function nomearPendentes<T extends Pendente>(base: BaseCrm, pendentes: T[]): Promise<(T & { nomeMostrar?: string })[]> {
  const adaptador = adaptadorDe(base.config);
  const lojas = Array.from(new Set(pendentes.filter((p) => !p.cliente).map((p) => p.loja)));
  const porLoja = new Map<string, Map<string, string>>();
  if (adaptador?.contatos) {
    await Promise.all(
      lojas.map(async (loja) => {
        const n = base.config.numeros.find((x) => x.loja === loja && x.sessao);
        if (n) porLoja.set(loja, await adaptador.contatos!(n.sessao).catch(() => new Map()));
      })
    );
  }
  return pendentes.map((p) => {
    const dig = p.telefone.replace(/\D/g, "");
    const salvo = porLoja.get(p.loja)?.get(dig) ?? porLoja.get(p.loja)?.get(dig.replace(/^55/, ""));
    return { ...p, nomeMostrar: p.cliente ?? salvo ?? p.apelido };
  });
}

/** Telefone pra mostrar: número brasileiro formatado, ou aviso quando é o id novo do WhatsApp (sem número). */
export function telefoneVisivel(tel: string): string | undefined {
  const d = tel.replace(/\D/g, "");
  if (d.startsWith("55") && (d.length === 12 || d.length === 13)) return d;
  return undefined;
}
