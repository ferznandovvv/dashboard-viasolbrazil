/**
 * Os arquivos de dados que não podem se perder: a base do CRM, a do
 * financeiro e as contas de acesso.
 *
 * No Windows, se a energia cai logo depois de gravar, o arquivo pode voltar
 * com o nome e o tamanho certos, mas cheio de zeros: o disco guardou a troca
 * de nome e não o conteúdo. Por isso a gravação força o disco antes de
 * trocar, e a versão anterior fica ao lado (.bak). Na leitura, um arquivo que
 * não abre é trocado pela cópia boa mais nova, e o estragado fica guardado.
 */

import { link, open, readFile, readdir, rename, rm, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { registrarErro } from "./registroDeErros";

/** Escreve no temporário, força o disco e só então troca; a versão anterior vira `.bak` (link, sem copiar). */
export async function gravarSeguro(arquivo: string, texto: string): Promise<void> {
  const tmp = `${arquivo}.tmp`;
  const fh = await open(tmp, "w");
  try {
    await fh.writeFile(texto, "utf8");
    await fh.sync();
  } finally {
    await fh.close();
  }
  const bak = `${arquivo}.bak`;
  await rm(bak, { force: true }).catch(() => {});
  await link(arquivo, bak).catch(() => {}); // primeira gravação, ou disco sem link: segue sem .bak
  await rename(tmp, arquivo);
}

/** Cópias com um nome de arquivo (exato ou por padrão) dentro das pastas indicadas. */
export async function copiasNasPastas(pastas: (string | undefined)[], nome: RegExp): Promise<string[]> {
  const out: string[] = [];
  for (const p of new Set(pastas.map((x) => x?.trim()).filter((x): x is string => Boolean(x)))) {
    for (const n of await readdir(p).catch(() => [] as string[])) if (nome.test(n)) out.push(join(p, n));
  }
  return out;
}

/** Pasta de backup anotada fora da base (a base pode ser justamente o que estragou). */
export const lerPastaAnotada = (arquivo: string) => readFile(arquivo, "utf8").then((t) => t.trim() || undefined).catch(() => undefined);

const recuperando = new Map<string, Promise<unknown>>();

/**
 * Lê um arquivo JSON. Se ele não abre (zerado, cortado) ou sumiu, usa a
 * cópia boa mais nova entre a versão anterior (.bak), o temporário e as
 * `copias` da pasta de backup, grava de volta e registra em /api/erros.
 * Devolve null quando o arquivo não existe e não há cópia (primeiro uso);
 * dá erro quando ele está estragado e nenhuma cópia serve.
 */
export async function lerComRecuperacao<T>(arquivo: string, valido: (x: unknown) => boolean, copias: () => Promise<string[]> = async () => []): Promise<T | null> {
  let motivo: string | null = null;
  try {
    const texto = await readFile(arquivo, "utf8");
    try {
      const obj = JSON.parse(texto) as unknown;
      if (valido(obj)) return obj as T;
      motivo = "veio com um conteúdo inesperado";
    } catch (e) {
      motivo = texto.startsWith("\u0000") ? "veio cheio de zeros (a energia caiu enquanto gravava)" : `não abre (${e instanceof Error ? e.message.slice(0, 80) : e})`;
    }
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }

  // Uma recuperação por arquivo de cada vez: os outros pedidos esperam e leem o resultado
  const emAndamento = recuperando.get(arquivo);
  if (emAndamento) {
    await emAndamento.catch(() => {});
    return lerComRecuperacao(arquivo, valido, copias);
  }
  const tarefa = recuperar<T>(arquivo, motivo, valido, copias);
  recuperando.set(arquivo, tarefa);
  try {
    return await tarefa;
  } finally {
    recuperando.delete(arquivo);
  }
}

async function recuperar<T>(arquivo: string, motivo: string | null, valido: (x: unknown) => boolean, copias: () => Promise<string[]>): Promise<T | null> {
  const nomes = [`${arquivo}.bak`, `${arquivo}.tmp`, ...(await copias().catch(() => [] as string[]))];
  const candidatas = (await Promise.all(nomes.map(async (n) => ({ n, t: (await stat(n).catch(() => null))?.mtimeMs ?? -1 }))))
    .filter((c) => c.t >= 0)
    .sort((a, b) => b.t - a.t);
  for (const c of candidatas) {
    let texto: string;
    try {
      texto = await readFile(c.n, "utf8");
      if (!valido(JSON.parse(texto))) continue;
    } catch {
      continue; // essa cópia também estragou: tenta a próxima
    }
    const carimbo = new Date().toISOString().replace(/[:.]/g, "-");
    if (motivo) await rename(arquivo, `${arquivo}.corrompido-${carimbo}`).catch(() => {});
    await gravarSeguro(arquivo, texto);
    const quando = new Date(c.t).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
    await registrarErro(
      `${basename(arquivo)} ${motivo ?? "sumiu"}: recuperado sozinho da cópia ${c.n}, de ${quando}`,
      motivo ? `o arquivo estragado ficou guardado como ${basename(arquivo)}.corrompido-${carimbo}` : "recuperado"
    );
    return JSON.parse(texto) as T;
  }
  if (!motivo) return null;
  throw new Error(
    `${basename(arquivo)} ${motivo} e não achei cópia boa para recuperar. Procure a cópia mais nova na pasta de backup e copie por cima de ${arquivo}.`
  );
}
