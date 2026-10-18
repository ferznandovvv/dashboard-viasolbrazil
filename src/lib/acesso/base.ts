/**
 * Pessoas que entram no sistema: um arquivo JSON na máquina (dados/acesso.json),
 * com o mesmo cuidado da base do financeiro — fila única de escrita e troca
 * atômica do arquivo. Só roda no servidor Node.
 *
 * Na primeira vez, os usuários do financeiro viram as contas do sistema com
 * as mesmas senhas: o administrador vira Dono e a equipe vira Financeiro.
 */

import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import type { Papel } from "./regras";

const DADOS = process.env.DADOS_DIR ?? join(process.cwd(), "dados");
export const ARQUIVO_ACESSO = join(DADOS, "acesso.json");

export interface Conta {
  id: string;
  nome: string;
  /** Usuário de entrar, minúsculo */
  login: string;
  hash: string;
  salt: string;
  papel: Papel;
  /** Papel loja: a loja (ou lojas) que esse usuário vê */
  lojas: string[];
  /** Sócia: além de ver, lança e paga contas no financeiro */
  podeLancar: boolean;
  /** Financeiro: vê o DRE */
  veDre: boolean;
  ativo: boolean;
  /** Muda quando a senha é trocada ou a conta é desligada: derruba as sessões abertas */
  versao: number;
  criadoEm: string;
}

export interface BaseAcesso {
  contas: Conta[];
  /** Assina o cookie de sessão */
  segredo: string;
  /** A senha única antiga do painel ainda entra, até o dono desligar */
  senhaAntiga: boolean;
  /**
   * Um dono já entrou com o próprio usuário. Até isso acontecer, a senha
   * antiga entra como Dono — assim ninguém fica trancado do lado de fora sem
   * saber o usuário; depois, ela passa a entrar como Sócia.
   */
  donoJaEntrou?: boolean;
}

export type ContaPublica = Omit<Conta, "hash" | "salt">;

export const contaPublica = ({ hash, salt, ...resto }: Conta): ContaPublica => (void hash, void salt, resto);

export const novoIdConta = () => randomUUID().slice(0, 8);

export function hashSenha(senha: string): { hash: string; salt: string } {
  const salt = randomBytes(16).toString("hex");
  return { salt, hash: scryptSync(senha, salt, 64).toString("hex") };
}

export function senhaConfere(c: Pick<Conta, "hash" | "salt">, senha: string): boolean {
  if (!c.hash || !c.salt) return false;
  const tentativa = scryptSync(senha, c.salt, 64);
  const certo = Buffer.from(c.hash, "hex");
  return certo.length === tentativa.length && timingSafeEqual(certo, tentativa);
}

// Cache e fila do processo inteiro (cada rota do Next tem suas próprias variáveis de módulo)
const g = globalThis as unknown as {
  __acesso?: { mtime: number; base: BaseAcesso };
  __filaAcesso?: Promise<unknown>;
};

/** Usuários que já existem no financeiro, com as mesmas senhas */
async function doFinanceiro(): Promise<Conta[]> {
  try {
    const fin = JSON.parse(await readFile(join(DADOS, "financeiro", "base.json"), "utf8")) as {
      usuarios?: { id: string; nome: string; login: string; hash: string; salt: string; papel: string; veDre?: boolean; ativo?: boolean; criadoEm?: string }[];
    };
    return (fin.usuarios ?? []).map((u) => ({
      id: u.id,
      nome: u.nome,
      login: u.login.trim().toLowerCase(),
      hash: u.hash,
      salt: u.salt,
      papel: u.papel === "admin" ? "dono" : "financeiro",
      lojas: [],
      podeLancar: true,
      veDre: u.papel === "admin" || Boolean(u.veDre),
      ativo: u.ativo !== false,
      versao: 1,
      criadoEm: u.criadoEm ?? new Date().toISOString(),
    }));
  } catch {
    return [];
  }
}

async function lerArquivo(): Promise<BaseAcesso> {
  try {
    return JSON.parse(await readFile(ARQUIVO_ACESSO, "utf8")) as BaseAcesso;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; // arquivo corrompido: não sobrescreve
    const base: BaseAcesso = { contas: await doFinanceiro(), segredo: randomBytes(32).toString("hex"), senhaAntiga: true };
    await gravar(base);
    return base;
  }
}

/** Grava num arquivo temporário e troca: queda de energia não corrompe a base. */
async function gravar(base: BaseAcesso): Promise<void> {
  await mkdir(DADOS, { recursive: true });
  const tmp = `${ARQUIVO_ACESSO}.tmp`;
  await writeFile(tmp, JSON.stringify(base, null, 1), "utf8");
  await rename(tmp, ARQUIVO_ACESSO);
  g.__acesso = undefined;
}

/** Leitura com cache: o porteiro consulta a cada pedido, então só relê se o arquivo mudou. */
export async function lerAcesso(): Promise<BaseAcesso> {
  await (g.__filaAcesso ?? Promise.resolve()).catch(() => {});
  try {
    const { mtimeMs } = await stat(ARQUIVO_ACESSO);
    if (g.__acesso?.mtime === mtimeMs) return g.__acesso.base;
    const base = await lerArquivo();
    g.__acesso = { mtime: mtimeMs, base };
    return base;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    return alterarAcesso((b) => b);
  }
}

/** Altera a base dentro da fila: lê, aplica `fn` e grava. Devolve o que `fn` devolver. */
export function alterarAcesso<T>(fn: (base: BaseAcesso) => T | Promise<T>): Promise<T> {
  const tarefa = (g.__filaAcesso ?? Promise.resolve())
    .catch(() => {})
    .then(async () => {
      const base = await lerArquivo();
      const r = await fn(base);
      await gravar(base);
      return r;
    });
  g.__filaAcesso = tarefa;
  return tarefa;
}
