import { list, put } from "@vercel/blob";

/**
 * Armazenamento de longa duração: Vercel Blob quando o sistema roda na
 * Vercel, pasta local quando roda numa máquina própria.
 *
 * O cache em memória sozinho não resolve na Vercel — cada requisição pode
 * cair numa instância nova, que começa vazia.
 */

const NA_VERCEL = Boolean(process.env.BLOB_READ_WRITE_TOKEN);

/**
 * O acesso a disco é carregado sob demanda: o empacotador do Next compila
 * estes módulos também para o Edge, onde `fs` não existe.
 */
async function disco() {
  const [fs, path] = await Promise.all([import("node:fs/promises"), import("node:path")]);
  const pasta = process.env.DADOS_DIR ?? path.join(process.cwd(), "dados");
  return {
    fs,
    caminho: (prefixo: string, chave: string) => path.join(pasta, `${prefixo}${chave}.json`),
    pastaDe: (arquivo: string) => path.dirname(arquivo),
  };
}

/** Listagem por prefixo, memorizada por alguns segundos dentro da instância. */
const listagens = new Map<string, { at: number; nomes: Map<string, string> }>();

async function listar(prefixo: string): Promise<Map<string, string>> {
  const guardada = listagens.get(prefixo);
  if (guardada && Date.now() - guardada.at < 10000) return guardada.nomes;
  const { blobs } = await list({ prefix: prefixo, limit: 1000 });
  const nomes = new Map(blobs.map((b) => [b.pathname, b.url]));
  listagens.set(prefixo, { at: Date.now(), nomes });
  return nomes;
}

/** Lê vários registros de uma vez (uma listagem só, downloads em paralelo). */
export async function lerBlobs<T>(prefixo: string, chaves: string[]): Promise<Map<string, T>> {
  const achados = new Map<string, T>();
  if (chaves.length === 0) return achados;

  if (!NA_VERCEL) {
    const d = await disco();
    await Promise.all(
      chaves.map(async (chave) => {
        try {
          const texto = await d.fs.readFile(d.caminho(prefixo, chave), "utf8");
          achados.set(chave, JSON.parse(texto) as T);
        } catch {
          /* arquivo ainda não existe */
        }
      })
    );
    return achados;
  }

  try {
    const porNome = await listar(prefixo);
    await Promise.all(
      chaves.map(async (chave) => {
        const url = porNome.get(`${prefixo}${chave}.json`);
        if (!url) return;
        const res = await fetch(url, { cache: "no-store" });
        if (res.ok) achados.set(chave, (await res.json()) as T);
      })
    );
  } catch {
    /* sem cache: seguimos buscando na origem */
  }
  return achados;
}

/**
 * Cache com validade curta, compartilhado entre as instâncias da Vercel.
 * O cache em memória sozinho quase nunca acerta, porque cada requisição pode
 * cair numa instância recém-criada.
 */
export async function comCacheBlob<T>(
  chave: string,
  ttlMs: number,
  buscar: () => Promise<T>
): Promise<T> {
  const guardado = await lerBlobs<{ at: number; dados: T }>("cache/", [chave]);
  const item = guardado.get(chave);
  if (item && Date.now() - item.at < ttlMs) return item.dados;

  const dados = await buscar();
  await gravarBlob("cache/", chave, { at: Date.now(), dados });
  return dados;
}

/** Grava um registro; falha de escrita nunca derruba a requisição. */
export async function gravarBlob(prefixo: string, chave: string, dados: unknown): Promise<void> {
  try {
    const corpo = JSON.stringify(dados);

    if (!NA_VERCEL) {
      // Em disco não há custo de transferência: grava de qualquer tamanho
      const d = await disco();
      const destino = d.caminho(prefixo, chave);
      await d.fs.mkdir(d.pastaDe(destino), { recursive: true });
      await d.fs.writeFile(destino, corpo, "utf8");
      return;
    }

    // Acima disso a gravação custa mais tempo do que o cache economiza
    if (corpo.length > 2_000_000) return;
    await put(`${prefixo}${chave}.json`, corpo, {
      access: "public",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/json",
    });
    listagens.delete(prefixo); // a listagem memorizada acabou de ficar velha
  } catch {
    /* melhor servir os dados sem cache do que falhar */
  }
}
