/**
 * Cache em memória por chave, compartilhado entre requisições da mesma
 * instância. Evita refazer as consultas dos canais a cada troca de filtro.
 */
const store = new Map<string, { at: number; valor: unknown }>();
const emVoo = new Map<string, Promise<unknown>>();

const TTL_PADRAO = 3 * 60 * 1000;

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

  const p = fn()
    .then((valor) => {
      store.set(chave, { at: Date.now(), valor });
      return valor;
    })
    .finally(() => emVoo.delete(chave));

  emVoo.set(chave, p);
  return p;
}
