/**
 * Leitura tolerante de variáveis de ambiente.
 *
 * `vercel env pull` grava os valores entre aspas, e arquivos editados à mão
 * costumam trazer espaço sobrando. Em vez de exigir que o arquivo esteja
 * perfeito, o sistema limpa o que lê.
 */
export function env(nome: string, padrao = ""): string {
  const bruto = process.env[nome] ?? padrao;
  return bruto.trim().replace(/^["']|["']$/g, "").trim();
}

/** Mesma limpeza, garantindo um endereço absoluto e sem barra no fim. */
export function envUrl(nome: string, padrao = ""): string {
  const valor = env(nome, padrao).replace(/\/+$/, "");
  if (!valor) return "";
  return /^https?:\/\//i.test(valor) ? valor : `https://${valor.replace(/^\/+/, "")}`;
}
