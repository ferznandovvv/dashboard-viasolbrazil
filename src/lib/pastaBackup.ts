/**
 * Pasta de backup padrão, para quem nunca configurou uma: no Google Drive
 * (ou OneDrive), se estiver instalado no computador, para ter cópia fora
 * dele; senão em Documentos. O CRM e o financeiro guardam lá uma cópia por
 * dia (a do dia é atualizada a cada 30 minutos de uso).
 */

import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { alterarBase as alterarCrm, lerBase as lerCrm } from "./crm/base";
import { alterarBase as alterarFin, lerBase as lerFin } from "./financeiro/base";

const NOME = "Backup Via Sol";
const ehPasta = (p: string) => stat(p).then((s) => s.isDirectory()).catch(() => false);

/** Google Drive ("G:\Meu Drive"), OneDrive ou, sem nuvem, Documentos. */
export async function pastaDeBackupPadrao(): Promise<{ pasta: string; nuvem: string | null }> {
  const casa = homedir();
  const nuvens: { p: string; nome: string }[] = [];
  if (process.platform === "win32") {
    for (const letra of "GDEFHIJKLMNOPQRSTUVWXYZ")
      for (const n of ["Meu Drive", "My Drive"]) nuvens.push({ p: `${letra}:\\${n}`, nome: "Google Drive" });
  }
  for (const n of ["Meu Drive", "My Drive"]) nuvens.push({ p: join(casa, "Google Drive", n), nome: "Google Drive" });
  nuvens.push({ p: join(casa, "Google Drive"), nome: "Google Drive" });
  for (const n of await readdir(casa).catch(() => [] as string[])) if (/^OneDrive/i.test(n)) nuvens.push({ p: join(casa, n), nome: "OneDrive" });
  for (const c of nuvens) if (await ehPasta(c.p)) return { pasta: join(c.p, NOME), nuvem: c.nome };
  return { pasta: join(casa, "Documents", NOME), nuvem: null };
}

/**
 * CRM ou financeiro sem pasta de backup ganham a padrão; a primeira cópia sai
 * logo depois de gravar (a base copia sozinha). Quem já configurou uma pasta
 * continua com a dela.
 */
export async function configurarBackupPadrao(): Promise<{ crm?: string; financeiro?: string } | null> {
  const [crm, fin] = await Promise.all([lerCrm(), lerFin()]);
  if (crm.config.backupDir?.trim() && fin.config.backupDir?.trim()) return null;
  const { pasta } = await pastaDeBackupPadrao();
  const feito: { crm?: string; financeiro?: string } = {};
  if (!crm.config.backupDir?.trim()) {
    await alterarCrm((x) => {
      if (!x.config.backupDir?.trim()) x.config.backupDir = pasta;
    });
    feito.crm = pasta;
  }
  if (!fin.config.backupDir?.trim()) {
    await alterarFin((x) => {
      if (!x.config.backupDir?.trim()) x.config.backupDir = pasta;
    });
    feito.financeiro = pasta;
  }
  return feito;
}

/** Situação do backup de uma base: a pasta e as cópias mais novas. */
export async function situacaoDoBackup(pasta: string | undefined, prefixo: "crm" | "financeiro") {
  if (!pasta?.trim()) return { pasta: "", existe: false, copias: [] as { nome: string; em: number; tamanho: number }[] };
  const nomes = (await readdir(pasta).catch(() => [] as string[])).filter((n) => new RegExp(`^${prefixo}-\\d{4}-\\d{2}-\\d{2}\\.json$`).test(n));
  const copias = (await Promise.all(nomes.map(async (nome) => ({ nome, st: await stat(join(pasta, nome)).catch(() => null) }))))
    .filter((c) => c.st)
    .map((c) => ({ nome: c.nome, em: c.st!.mtimeMs, tamanho: c.st!.size }))
    .sort((a, b) => b.em - a.em);
  return { pasta, existe: await ehPasta(pasta), copias };
}
