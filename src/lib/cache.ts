import { comCacheBlob } from "./blobCache";

/**
 * Cache em duas camadas: memória da instância e, atrás dela, o Vercel Blob.
 * A camada compartilhada é o que faz diferença aqui — cada requisição pode
 * cair numa instância nova, que nasce com a memória vazia, então sem ela o
 * cache quase nunca acertava.
 */
const store = new Map<string, { at: number; valor: unknown }>();
const emVoo = new Map<string, Promise<unknown>>();

const TTL_PADRAO = 3 * 60 * 1000;

/** Nome de arquivo seguro para a chave do cache compartilhado. */
function nomeArquivo(chave: string): string {
  return chave.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export async function comCache<T>(
  chave: string,
  fn: () => Promise<T>,
  ttl = TTL_PADRAO
): Promise<T> {
  const hit = store.get(chave);
  if (hit && Date.now() - hit.at < ttl) return hit.valor as T;

  // Duas requisições simultâneas com a mesma chave compartilham a busca
  const voando = emVoo.get(chave);
  if (voando) return voando as Promise<T>;

  const p = comCacheBlob(nomeArquivo(chave), ttl, fn)
    .then((valor) => {
      store.set(chave, { at: Date.now(), valor });
      return valor;
    })
    .finally(() => emVoo.delete(chave));

  emVoo.set(chave, p);
  return p;
}
