/**
 * Credenciais guardadas em disco, para o sistema rodando numa máquina própria.
 *
 * Fora da Vercel, recolocar dezenas de chaves editando o .env.local e
 * reiniciando é sofrido. Aqui elas ficam em dados/credenciais.json, entram no
 * process.env ao carregar e valem na hora quando são salvas — pela tela de
 * configuração ou automaticamente, ao concluir uma autorização.
 *
 * Só roda no servidor Node. Nunca importar a partir do middleware.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const ARQUIVO = join(process.env.DADOS_DIR ?? join(process.cwd(), "dados"), "credenciais.json");

/** Valor ausente, vazio ou o marcador que a Vercel grava no lugar do segredo. */
function vazio(valor: string | undefined): boolean {
  const v = (valor ?? "").trim().replace(/^["']|["']$/g, "").trim();
  return !v || v === "[SENSITIVE]";
}

/** Na Vercel de verdade, VERCEL_URL vem preenchida; numa máquina, não. */
export function rodandoLocal(): boolean {
  return vazio(process.env.VERCEL_URL);
}

function ler(): Record<string, string> {
  try {
    return JSON.parse(readFileSync(ARQUIVO, "utf8")) as Record<string, string>;
  } catch {
    return {};
  }
}

let carregado = false;

/** Leva o arquivo para o process.env, sem sobrescrever o que já veio preenchido. */
export function carregarCredenciais(): void {
  if (carregado) return;
  carregado = true;
  for (const [nome, valor] of Object.entries(ler())) {
    if (vazio(process.env[nome]) && !vazio(valor)) process.env[nome] = valor;
  }
}

/** Grava e já aplica: a próxima consulta usa o valor novo, sem reiniciar. */
export function salvarCredenciais(novas: Record<string, string>): void {
  const atuais = ler();
  for (const [nome, valor] of Object.entries(novas)) {
    const limpo = (valor ?? "").trim();
    if (!limpo) continue;
    atuais[nome] = limpo;
    process.env[nome] = limpo;
  }
  mkdirSync(dirname(ARQUIVO), { recursive: true });
  writeFileSync(ARQUIVO, JSON.stringify(atuais, null, 2), "utf8");
}

/** Quais chaves estão preenchidas — sem nunca devolver o valor. */
export function situacaoCredenciais(nomes: string[]): Record<string, boolean> {
  carregarCredenciais();
  return Object.fromEntries(nomes.map((n) => [n, !vazio(process.env[n])]));
}

carregarCredenciais();
