/**
 * Usuários e senhas do painel, direto no computador da empresa: mostra quem
 * pode entrar e troca a senha de quem esqueceu. Serve também para o dono que
 * não lembra o próprio usuário. Só funciona aqui porque mexe no arquivo
 * dados/acesso.json da máquina — de fora não tem como.
 *
 * Uso: node scripts/acesso.mjs   (o esqueci-a-senha.cmd já chama)
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, randomUUID, scryptSync } from "node:crypto";
import { createInterface } from "node:readline";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const DADOS = process.env.DADOS_DIR ?? join(RAIZ, "dados");
const ARQUIVO = join(DADOS, "acesso.json");
const PAPEIS = { dono: "Dono", socia: "Sócia", financeiro: "Financeiro", loja: "Loja" };

/** Mesma regra do sistema: na primeira vez, os usuários do financeiro viram contas */
function ler() {
  if (existsSync(ARQUIVO)) return JSON.parse(readFileSync(ARQUIVO, "utf8"));
  let usuarios = [];
  try {
    usuarios = JSON.parse(readFileSync(join(DADOS, "financeiro", "base.json"), "utf8")).usuarios ?? [];
  } catch {
    /* sem financeiro */
  }
  return {
    contas: usuarios.map((u) => ({
      id: u.id, nome: u.nome, login: u.login.trim().toLowerCase(), hash: u.hash, salt: u.salt,
      papel: u.papel === "admin" ? "dono" : "financeiro", lojas: [], podeLancar: true,
      veDre: u.papel === "admin" || Boolean(u.veDre), ativo: u.ativo !== false, versao: 1,
      criadoEm: u.criadoEm ?? new Date().toISOString(),
    })),
    segredo: randomBytes(32).toString("hex"),
    senhaAntiga: true,
  };
}

function gravar(base) {
  mkdirSync(DADOS, { recursive: true });
  writeFileSync(`${ARQUIVO}.tmp`, JSON.stringify(base, null, 1), "utf8");
  renameSync(`${ARQUIVO}.tmp`, ARQUIVO);
}

function hash(senha) {
  const salt = randomBytes(16).toString("hex");
  return { salt, hash: scryptSync(senha, salt, 64).toString("hex") };
}

// Linhas lidas numa fila: funciona digitando na janela e também com a resposta já pronta na entrada
const rl = createInterface({ input: process.stdin });
const linhas = rl[Symbol.asyncIterator]();
async function perguntar(texto) {
  process.stdout.write(texto);
  const { value, done } = await linhas.next();
  if (done) {
    console.log("");
    process.exit(0);
  }
  return value.trim();
}

async function senhaNova() {
  for (;;) {
    const s = await perguntar("Senha nova (pelo menos 6 caracteres): ");
    if (s.length >= 6) return s;
    console.log("  Curta demais. Tente de novo.");
  }
}

const base = ler();
console.log("\nPainel Via Sol — usuários e senhas\n");

if (!base.contas.length) {
  console.log("Ainda não existe nenhum usuário. Vamos criar o do Dono.\n");
  const nome = await perguntar("Seu nome: ");
  const login = (await perguntar("Usuário (sem espaço, ex.: fernando): ")).toLowerCase().replace(/\s/g, "");
  const senha = await senhaNova();
  base.contas.push({
    id: randomUUID().slice(0, 8), nome, login, ...hash(senha), papel: "dono", lojas: [],
    podeLancar: true, veDre: true, ativo: true, versao: 1, criadoEm: new Date().toISOString(),
  });
  gravar(base);
  console.log(`\nPronto. Entre no painel com o usuário "${login}" e a senha que você escolheu.`);
  rl.close();
  process.exit(0);
}

console.log("Quem pode entrar:\n");
for (const c of base.contas) {
  const extra = c.papel === "loja" ? ` (${c.lojas.join(", ")})` : "";
  console.log(`  usuário: ${c.login.padEnd(16)} ${c.nome} — ${PAPEIS[c.papel] ?? c.papel}${extra}${c.ativo ? "" : " — DESLIGADO"}`);
}
console.log("");

const login = (await perguntar("Para trocar uma senha, digite o usuário (ou só Enter para sair): ")).toLowerCase();
if (!login) {
  rl.close();
  process.exit(0);
}
const conta = base.contas.find((c) => c.login === login);
if (!conta) {
  console.log(`\nNão existe o usuário "${login}". Nada foi mudado.`);
  rl.close();
  process.exit(1);
}
const senha = await senhaNova();
Object.assign(conta, hash(senha), { versao: (conta.versao ?? 1) + 1, ativo: true });
gravar(base);
console.log(`\nSenha de ${conta.nome} trocada. Entre com o usuário "${conta.login}" e a senha nova.`);
console.log("Quem estava conectado com a senha velha vai precisar entrar de novo.");
rl.close();
