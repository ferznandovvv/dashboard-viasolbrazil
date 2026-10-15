/**
 * Onde o financeiro mora: um arquivo JSON na máquina (dados/financeiro), com
 * cópia de segurança numa pasta do Google Drive/OneDrive.
 *
 * Toda escrita passa por uma fila única do processo, para dois lançamentos
 * ao mesmo tempo não se atropelarem. Só roda no servidor Node.
 */

import { copyFile, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { LOJAS } from "../connectors/totvs";
import { CATEGORIAS_PADRAO, type BaseFinanceira } from "./tipos";

const PASTA = join(process.env.DADOS_DIR ?? join(process.cwd(), "dados"), "financeiro");
const ARQUIVO = join(PASTA, "base.json");
/** Cópias diárias guardadas na pasta de backup */
const MANTER_COPIAS = 60;
/** Entre uma cópia e outra, no máximo isto (a do dia é sobrescrita) */
const INTERVALO_BACKUP_MS = 30 * 60000;

/** Lojas e canais que podem virar receita de uma empresa. */
export const UNIDADES = [...Object.values(LOJAS), "Site", "TikTok Shop", "Mercado Livre"];

export const novoId = () => randomUUID().slice(0, 8);

function inicial(): BaseFinanceira {
  return {
    versao: 1,
    empresas: [{ id: novoId(), nome: "Via Sol Brazil", unidades: [...UNIDADES], ativa: true }],
    categorias: CATEGORIAS_PADRAO.map(([nome, grupo]) => ({ id: novoId(), nome, grupo, ativa: true })),
    usuarios: [],
    contas: [],
    config: { segredo: randomBytes(32).toString("hex") },
  };
}

// Fila e controle do backup compartilhados pelo processo (cada rota do Next
// tem suas próprias variáveis de módulo)
const global = globalThis as unknown as { __filaFin?: Promise<unknown>; __backupFin?: number };

async function ler(): Promise<BaseFinanceira> {
  try {
    return JSON.parse(await readFile(ARQUIVO, "utf8")) as BaseFinanceira;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; // arquivo corrompido: não sobrescreve
    const base = inicial();
    await gravar(base);
    return base;
  }
}

/** Grava num arquivo temporário e troca: queda de energia não corrompe a base. */
async function gravar(base: BaseFinanceira): Promise<void> {
  await mkdir(PASTA, { recursive: true });
  const tmp = `${ARQUIVO}.tmp`;
  await writeFile(tmp, JSON.stringify(base, null, 1), "utf8");
  await rename(tmp, ARQUIVO);
}

/** Leitura simples, para consultas. */
export async function lerBase(): Promise<BaseFinanceira> {
  await (global.__filaFin ?? Promise.resolve()).catch(() => {}); // espera uma escrita em andamento
  return ler();
}

/**
 * Altera a base: lê a versão atual, aplica `fn` e grava — tudo na fila, um
 * de cada vez. O que `fn` devolver é devolvido aqui.
 */
export function alterarBase<T>(fn: (base: BaseFinanceira) => T | Promise<T>): Promise<T> {
  const tarefa = (global.__filaFin ?? Promise.resolve())
    .catch(() => {})
    .then(async () => {
      const base = await ler();
      const r = await fn(base);
      await gravar(base);
      void copiaDeSeguranca(base);
      return r;
    });
  global.__filaFin = tarefa;
  return tarefa;
}

/**
 * Copia a base para a pasta de backup, uma cópia por dia (a do dia vai sendo
 * atualizada). Falha aqui nunca derruba o lançamento.
 */
export async function copiaDeSeguranca(base: BaseFinanceira, forcar = false): Promise<string> {
  const dir = base.config.backupDir?.trim();
  if (!dir) return "sem pasta de backup configurada";
  if (!forcar && Date.now() - (global.__backupFin ?? 0) < INTERVALO_BACKUP_MS) return "aguardando";
  try {
    await mkdir(dir, { recursive: true });
    const dia = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
    await copyFile(ARQUIVO, join(dir, `financeiro-${dia}.json`));
    global.__backupFin = Date.now();
    const copias = (await readdir(dir)).filter((n) => /^financeiro-\d{4}-\d{2}-\d{2}\.json$/.test(n)).sort();
    for (const velha of copias.slice(0, Math.max(0, copias.length - MANTER_COPIAS))) {
      await rm(join(dir, velha), { force: true });
    }
    return `ok — financeiro-${dia}.json`;
  } catch (e) {
    return `falhou: ${e instanceof Error ? e.message : e}`;
  }
}
