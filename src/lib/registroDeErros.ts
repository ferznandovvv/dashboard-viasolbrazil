/**
 * Registro dos erros do servidor em dados/erros.log, para ver depois pela
 * página /api/erros (só o dono). A janela do painel some com o que passou;
 * aqui fica a mensagem e de onde veio. O arquivo é cortado ao passar de 1 MB.
 */

const LIMITE = 1024 * 1024;

async function arquivo() {
  const path = await import("node:path");
  return path.join(process.env.DADOS_DIR ?? path.join(process.cwd(), "dados"), "erros.log");
}

export async function registrarErro(onde: string, e: unknown): Promise<void> {
  const quando = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
  const detalhe = e instanceof Error ? (e.stack ?? e.message) : String(e);
  console.error(`[erro] ${onde}:`, detalhe);
  try {
    const fs = await import("node:fs/promises");
    const f = await arquivo();
    const tam = await fs.stat(f).then((s) => s.size).catch(() => 0);
    if (tam > LIMITE) await fs.writeFile(f, "");
    await fs.appendFile(f, `[${quando}] ${onde}\n${detalhe}\n\n`);
  } catch {
    /* sem disco: fica só na janela */
  }
}

/** As últimas linhas do registro (mais recentes no fim). */
export async function ultimosErros(linhas = 300): Promise<string> {
  try {
    const fs = await import("node:fs/promises");
    const texto = await fs.readFile(await arquivo(), "utf8");
    return texto.split("\n").slice(-linhas).join("\n");
  } catch {
    return "";
  }
}
