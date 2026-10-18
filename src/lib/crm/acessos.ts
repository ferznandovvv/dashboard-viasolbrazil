/**
 * Quando cada loja abriu o painel da loja. Conta só o computador da loja (código
 * de aparelho) e o usuário de loja; dono e sócia olhando não contam. E só conta
 * com a aba visível: aba esquecida atrás de outra não é "olhando".
 *
 * Fica num arquivo à parte (dados/crm/acessos.json) porque o painel pergunta a
 * cada minuto e não vale regravar a base inteira por isso. Junta na memória e
 * grava no máximo a cada 5 minutos.
 */

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { LOJAS } from "@/lib/connectors/totvs";
import { hojeSp, somarDias } from "./base";

const PASTA = join(process.env.DADOS_DIR ?? join(process.cwd(), "dados"), "crm");
const ARQUIVO = join(PASTA, "acessos.json");
const GUARDA_DIAS = 30;
const GRAVA_A_CADA = 5 * 60000;

interface Dia {
  /** Hora do primeiro e do último sinal (HH:MM, horário de Brasília) */
  primeiro: string;
  ultimo: string;
  /** Minutos com o painel aberto e visível (um sinal por minuto) */
  minutos: number;
}
type Acessos = Record<string, { ultimo: string; dias: Record<string, Dia> }>;

let cache: Acessos | null = null;
let gravadoEm = 0;
let gravando: Promise<void> | null = null;

async function carregar(): Promise<Acessos> {
  if (cache) return cache;
  try {
    cache = JSON.parse(await readFile(ARQUIVO, "utf8")) as Acessos;
  } catch {
    cache = {};
  }
  return cache;
}

async function gravar(a: Acessos) {
  const corte = somarDias(hojeSp(), -GUARDA_DIAS);
  for (const l of Object.values(a)) for (const d of Object.keys(l.dias)) if (d < corte) delete l.dias[d];
  await mkdir(PASTA, { recursive: true });
  const tmp = `${ARQUIVO}.tmp`;
  await writeFile(tmp, JSON.stringify(a), "utf8");
  await rename(tmp, ARQUIVO);
}

const horaSp = (d = new Date()) => new Date(d.getTime() - 3 * 3600000).toISOString().slice(11, 16);

/** Um sinal do painel da loja aberto e visível. */
export async function registrarAcesso(loja: string): Promise<void> {
  const a = await carregar();
  const agora = new Date();
  const dia = hojeSp();
  const l = (a[loja] ??= { ultimo: agora.toISOString(), dias: {} });
  const ultimoAntes = new Date(l.ultimo).getTime();
  l.ultimo = agora.toISOString();
  const d = (l.dias[dia] ??= { primeiro: horaSp(agora), ultimo: horaSp(agora), minutos: 0 });
  d.ultimo = horaSp(agora);
  // Duas abas abertas ou recarregar a página não contam minuto em dobro
  if (agora.getTime() - ultimoAntes >= 45000 || d.minutos === 0) d.minutos++;
  if (Date.now() - gravadoEm >= GRAVA_A_CADA && !gravando) {
    gravadoEm = Date.now();
    gravando = gravar(a)
      .catch((e) => console.error("[crm] acessos:", e))
      .finally(() => (gravando = null));
  }
}

export interface AcessoLoja {
  loja: string;
  /** Último sinal (ISO) ou null se nunca abriu */
  ultimo: string | null;
  /** Hoje: de que horas a que horas e quantos minutos */
  hoje: Dia | null;
  /** Em quantos dos últimos 7 dias abriu */
  dias7: number;
}

export async function acessosDasLojas(): Promise<AcessoLoja[]> {
  const a = await carregar();
  const hoje = hojeSp();
  const desde = somarDias(hoje, -6);
  return Object.values(LOJAS).map((loja) => {
    const l = a[loja];
    return {
      loja,
      ultimo: l?.ultimo ?? null,
      hoje: l?.dias[hoje] ?? null,
      dias7: l ? Object.keys(l.dias).filter((d) => d >= desde).length : 0,
    };
  });
}
