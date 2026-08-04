import { list, put } from "@vercel/blob";

/**
 * Cache de longa duração no Vercel Blob, usado para os meses já fechados das
 * lojas físicas. O cache em memória não resolve aqui: cada requisição na
 * Vercel pode cair numa instância nova, que começa com a memória vazia.
 */

/** Lê vários registros de uma vez (uma listagem só, downloads em paralelo). */
export async function lerBlobs<T>(prefixo: string, chaves: string[]): Promise<Map<string, T>> {
  const achados = new Map<string, T>();
  if (!process.env.BLOB_READ_WRITE_TOKEN || chaves.length === 0) return achados;
  try {
    const { blobs } = await list({ prefix: prefixo, limit: 1000 });
    const porNome = new Map(blobs.map((b) => [b.pathname, b.url]));
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

/** Grava um registro; falha de escrita nunca derruba a requisição. */
export async function gravarBlob(prefixo: string, chave: string, dados: unknown): Promise<void> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return;
  try {
    await put(`${prefixo}${chave}.json`, JSON.stringify(dados), {
      access: "public",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/json",
    });
  } catch {
    /* melhor servir os dados sem cache do que falhar */
  }
}
