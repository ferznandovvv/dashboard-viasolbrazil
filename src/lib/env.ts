/**
 * Leitura tolerante de variáveis de ambiente.
 *
 * `vercel env pull` grava os valores entre aspas, e arquivos editados à mão
 * costumam trazer espaço sobrando. Em vez de exigir que o arquivo esteja
 * perfeito, o sistema limpa o que lê.
 */
export function env(nome: string, padrao = ""): string {
  const bruto = process.env[nome] ?? padrao;
  const valor = bruto.trim().replace(/^["']|["']$/g, "").trim();
  // A Vercel não devolve variáveis marcadas como sensíveis: `vercel env pull`
  // grava este texto no lugar do valor. Tratar como ausente faz a tela dizer
  // "não conectado" em vez de tentar usar a palavra como se fosse a chave.
  if (valor === "[SENSITIVE]") return padrao.trim();
  return valor;
}

/** Mesma limpeza, garantindo um endereço absoluto e sem barra no fim. */
export function envUrl(nome: string, padrao = ""): string {
  const valor = env(nome, padrao).replace(/\/+$/, "");
  if (!valor) return "";
  return /^https?:\/\//i.test(valor) ? valor : `https://${valor.replace(/^\/+/, "")}`;
}
