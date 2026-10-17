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
/** Boletos e comprovantes anexados às contas */
export const PASTA_ANEXOS = join(PASTA, "anexos");
/** Cópias diárias guardadas na pasta de backup */
const MANTER_COPIAS = 60;
/** Entre uma cópia e outra, no máximo isto (a do dia é sobrescrita) */
const INTERVALO_BACKUP_MS = 30 * 60000;

/** Lojas e canais que podem virar receita de uma empresa. */
export const UNIDADES = [...Object.values(LOJAS), "Site", "TikTok Shop", "Mercado Livre", "Shopee"];

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

/**
 * Ajustes que entram com versões novas do sistema e precisam valer também
 * para a base que já existe na máquina. Cada um roda uma vez só.
 */
const MIGRACOES: { id: string; aplicar: (b: BaseFinanceira) => void }[] = [
  {
    // Categorias de produção (Barracão), no grupo do custo da mercadoria
    id: "categorias-producao",
    aplicar: (b) => {
      for (const nome of ["Tecidos e aviamentos", "Costura / facção", "Estamparia / bordado", "Embalagem"]) {
        if (!b.categorias.some((c) => c.nome.toLowerCase() === nome.toLowerCase()))
          b.categorias.push({ id: novoId(), nome, grupo: "cmv", ativa: true });
      }
    },
  },
  {
    // Empresas com o mesmo nome criadas por duplo clique: fica a primeira;
    // as repetidas sem nenhuma conta saem
    id: "empresas-repetidas",
    aplicar: (b) => {
      const vistos = new Set<string>();
      b.empresas = b.empresas.filter((e) => {
        const nome = e.nome.trim().toLowerCase();
        const repetida = vistos.has(nome) && !b.contas.some((c) => c.empresaId === e.id);
        vistos.add(nome);
        return !repetida;
      });
    },
  },
];

MIGRACOES.push({
  // Shopee entrou como canal: vai para a empresa que já tem os outros canais online
  id: "canal-shopee",
  aplicar: (b) => {
    if (b.empresas.some((e) => e.unidades.includes("Shopee"))) return;
    const dona = b.empresas.find((e) => e.unidades.includes("Mercado Livre") || e.unidades.includes("Site"));
    if (dona) dona.unidades.push("Shopee");
  },
});

MIGRACOES.push({
  // Rateio deixou de ser por loja: cada parte vai para a empresa dona da loja
  id: "rateio-por-empresa",
  aplicar: (b) => {
    for (const c of b.contas) {
      if (!c.rateio?.length) continue;
      const porEmpresa = new Map<string, number>();
      for (const p of c.rateio) {
        const empresaId =
          p.empresaId || b.empresas.find((e) => p.unidade && e.unidades.includes(p.unidade))?.id || c.empresaId;
        porEmpresa.set(empresaId, (porEmpresa.get(empresaId) ?? 0) + p.valor);
      }
      c.rateio =
        porEmpresa.size > 1 ? Array.from(porEmpresa, ([empresaId, valor]) => ({ empresaId, valor })) : undefined;
    }
  },
});

const precisaMigrar = (b: BaseFinanceira) => MIGRACOES.some((m) => !b.config.migracoes?.includes(m.id));

function migrar(b: BaseFinanceira) {
  for (const m of MIGRACOES) {
    if (b.config.migracoes?.includes(m.id)) continue;
    m.aplicar(b);
    b.config.migracoes = [...(b.config.migracoes ?? []), m.id];
  }
}

/** Leitura simples, para consultas. */
export async function lerBase(): Promise<BaseFinanceira> {
  await (global.__filaFin ?? Promise.resolve()).catch(() => {}); // espera uma escrita em andamento
  const base = await ler();
  if (!precisaMigrar(base)) return base;
  await alterarBase(() => {}); // a migração roda dentro da fila, gravando uma vez
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
      migrar(base);
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
    // Anexos: copia os que ainda não estão lá (nunca mudam depois de enviados)
    const anexos = await readdir(PASTA_ANEXOS).catch(() => [] as string[]);
    if (anexos.length) {
      const destino = join(dir, "anexos");
      await mkdir(destino, { recursive: true });
      const ja = new Set(await readdir(destino));
      for (const a of anexos) if (!ja.has(a)) await copyFile(join(PASTA_ANEXOS, a), join(destino, a));
    }
    return `ok — financeiro-${dia}.json`;
  } catch (e) {
    return `falhou: ${e instanceof Error ? e.message : e}`;
  }
}
