/**
 * Onde o CRM mora: um arquivo JSON na máquina (dados/crm/base.json), com
 * cópia de segurança numa pasta à escolha, igual ao financeiro.
 *
 * Toda escrita passa por uma fila única do processo. Só roda no servidor Node.
 */

import { copyFile, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { type BaseCrm, CONFIG_PADRAO, MODELOS_PADRAO } from "./tipos";

const PASTA = join(process.env.DADOS_DIR ?? join(process.cwd(), "dados"), "crm");
const ARQUIVO = join(PASTA, "base.json");
const MANTER_COPIAS = 60;
const INTERVALO_BACKUP_MS = 30 * 60000;

export const novoId = () => randomUUID().slice(0, 10);

function inicial(): BaseCrm {
  return {
    versao: 1,
    clientes: [],
    vendas: [],
    cashback: [],
    codigos: [],
    mensagens: [],
    recebidas: [],
    modelos: structuredClone(MODELOS_PADRAO),
    config: { ...CONFIG_PADRAO, webhookSegredo: randomBytes(12).toString("hex") },
  };
}

const global = globalThis as unknown as { __filaCrm?: Promise<unknown>; __backupCrm?: number };

async function ler(): Promise<BaseCrm> {
  try {
    return JSON.parse(await readFile(ARQUIVO, "utf8")) as BaseCrm;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; // corrompido: não sobrescreve
    const base = inicial();
    await gravar(base);
    return base;
  }
}

/** Grava num arquivo temporário e troca: queda de energia não corrompe a base. */
async function gravar(base: BaseCrm): Promise<void> {
  await mkdir(PASTA, { recursive: true });
  const tmp = `${ARQUIVO}.tmp`;
  await writeFile(tmp, JSON.stringify(base), "utf8");
  await rename(tmp, ARQUIVO);
}

/** Ajustes que entram com versões novas e precisam valer para a base que já existe. */
const MIGRACOES: { id: string; aplicar: (b: BaseCrm) => void }[] = [
  {
    // Campos de configuração que não existiam ganham o valor padrão
    id: "config-padrao",
    aplicar: (b) => {
      b.config = { ...CONFIG_PADRAO, ...b.config };
      b.recebidas ??= [];
      b.codigos ??= [];
      for (const m of MODELOS_PADRAO) {
        if (!b.modelos.some((x) => x.campanha === m.campanha)) b.modelos.push(structuredClone(m));
      }
    },
  },
];

const precisaMigrar = (b: BaseCrm) => MIGRACOES.some((m) => !b.config.migracoes?.includes(m.id));

function migrar(b: BaseCrm) {
  for (const m of MIGRACOES) {
    if (b.config.migracoes?.includes(m.id)) continue;
    m.aplicar(b);
    b.config.migracoes = [...(b.config.migracoes ?? []), m.id];
  }
}

/** Leitura simples, para consultas. */
export async function lerBase(): Promise<BaseCrm> {
  await (global.__filaCrm ?? Promise.resolve()).catch(() => {});
  const base = await ler();
  if (!precisaMigrar(base)) return base;
  await alterarBase(() => {});
  return ler();
}

/** Altera a base: lê, aplica `fn` e grava, um de cada vez. Devolve o que `fn` devolver. */
export function alterarBase<T>(fn: (base: BaseCrm) => T | Promise<T>): Promise<T> {
  const tarefa = (global.__filaCrm ?? Promise.resolve())
    .catch(() => {})
    .then(async () => {
      const base = await ler();
      migrar(base);
      const r = await fn(base);
      await gravar(base);
      void copiaDeSeguranca(base);
      return r;
    });
  global.__filaCrm = tarefa;
  return tarefa;
}

/** Uma cópia por dia na pasta de backup. Falha aqui nunca derruba a operação. */
export async function copiaDeSeguranca(base: BaseCrm, forcar = false): Promise<string> {
  const dir = base.config.backupDir?.trim();
  if (!dir) return "sem pasta de backup configurada";
  if (!forcar && Date.now() - (global.__backupCrm ?? 0) < INTERVALO_BACKUP_MS) return "aguardando";
  try {
    await mkdir(dir, { recursive: true });
    const dia = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
    await copyFile(ARQUIVO, join(dir, `crm-${dia}.json`));
    global.__backupCrm = Date.now();
    const copias = (await readdir(dir)).filter((n) => /^crm-\d{4}-\d{2}-\d{2}\.json$/.test(n)).sort();
    for (const velha of copias.slice(0, Math.max(0, copias.length - MANTER_COPIAS))) {
      await rm(join(dir, velha), { force: true });
    }
    return `ok — crm-${dia}.json`;
  } catch (e) {
    return `falhou: ${e instanceof Error ? e.message : e}`;
  }
}

/** Data de hoje em SP, YYYY-MM-DD. */
export const hojeSp = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });

/** Soma dias a uma data YYYY-MM-DD. */
export function somarDias(data: string, dias: number): string {
  const d = new Date(`${data}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/** Diferença em dias entre duas datas YYYY-MM-DD (b - a). */
export function diasEntre(a: string, b: string): number {
  return Math.round((new Date(`${b}T12:00:00Z`).getTime() - new Date(`${a}T12:00:00Z`).getTime()) / 86400000);
}

export const dataBr = (d?: string) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : "");
export const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
export const primeiroNome = (nome: string) => {
  const p = nome.trim().split(/\s+/)[0] ?? "";
  return p ? p[0].toUpperCase() + p.slice(1).toLowerCase() : "";
};
