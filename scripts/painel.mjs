/**
 * Mantém o painel no ar na máquina da empresa e se atualiza sozinho.
 *
 * A cada 5 minutos confere se há versão nova no GitHub. Se houver: baixa,
 * monta a versão nova numa pasta separada enquanto a atual continua no ar, e
 * só então troca — o painel fica fora por poucos segundos. Se a montagem
 * falhar, a versão anterior continua rodando. Se o painel cair, sobe de novo.
 *
 * Também liga e vigia a WA-AKG (WhatsApp das lojas), se ela estiver instalada
 * na pasta WA-AKG ao lado do painel: tudo numa janela só. O que a WA-AKG
 * escreve vai para dados/whatsapp.log, para não poluir esta janela.
 *
 * Uso: node scripts/painel.mjs   (o iniciar-painel.cmd já chama)
 */

import { spawn } from "node:child_process";
import { connect } from "node:net";
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const DADOS = process.env.DADOS_DIR ?? join(RAIZ, "dados");
const ESTADO = join(DADOS, "painel-estado.json");
const LOG = join(DADOS, "painel.log");
const PORTA = process.env.PORT ?? "3100";
const INTERVALO_MS = Number(process.env.PAINEL_INTERVALO_MS) || 5 * 60000;
const NEXT = join(RAIZ, "node_modules", "next", "dist", "bin", "next");

mkdirSync(DADOS, { recursive: true });

function log(msg) {
  const linha = `[${new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}] ${msg}`;
  console.log(linha);
  try {
    appendFileSync(LOG, linha + "\n");
  } catch {
    /* log é só ajuda */
  }
}

function lerEstado() {
  try {
    return JSON.parse(readFileSync(ESTADO, "utf8"));
  } catch {
    return {};
  }
}
let estado = lerEstado();
function salvarEstado(mudancas) {
  estado = { ...estado, ...mudancas };
  writeFileSync(ESTADO, JSON.stringify(estado, null, 1));
}

/** Roda um comando e devolve { ok, saida }. */
function rodar(cmd, args, opcoes = {}) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { cwd: RAIZ, shell: opcoes.shell ?? false, env: { ...process.env, ...opcoes.env } });
    let saida = "";
    p.stdout.on("data", (d) => {
      saida += d;
      if (opcoes.mostrar) process.stdout.write(d);
    });
    p.stderr.on("data", (d) => {
      saida += d;
      if (opcoes.mostrar) process.stderr.write(d);
    });
    p.on("error", (e) => resolve({ ok: false, saida: String(e) }));
    p.on("close", (codigo) => resolve({ ok: codigo === 0, saida: saida.trim() }));
  });
}

const git = (...args) => rodar("git", args);
const commitAtual = async () => (await git("rev-parse", "HEAD")).saida;

async function montar(pasta) {
  log(`Montando a versão nova em ${pasta} (1 ou 2 minutos)…`);
  const r = await rodar(process.execPath, [NEXT, "build"], { env: { NEXT_DIST_DIR: pasta }, mostrar: true });
  if (!r.ok) log(`A montagem falhou — a versão anterior continua no ar.\n${r.saida.slice(-1500)}`);
  return r.ok;
}

// ——— Servidor ———
let servidor = null;
let trocando = false;

function subir(pasta) {
  log(`Painel no ar em http://localhost:${PORTA} (${pasta}) — não feche esta janela.`);
  const p = spawn(process.execPath, [NEXT, "start", "-p", PORTA], {
    cwd: RAIZ,
    env: { ...process.env, NEXT_DIST_DIR: pasta, PORT: PORTA },
    stdio: "inherit",
  });
  servidor = p;
  p.on("exit", (codigo) => {
    if (servidor !== p) return; // foi trocado de propósito
    servidor = null;
    if (trocando) return;
    log(`O painel parou (código ${codigo}). Subindo de novo em 5 segundos…`);
    setTimeout(() => !servidor && subir(estado.pasta ?? ".next-a"), 5000);
  });
}

function derrubar() {
  return new Promise((resolve) => {
    const p = servidor;
    if (!p) return resolve();
    servidor = null;
    p.once("exit", () => resolve());
    p.kill();
    setTimeout(resolve, 8000); // não espera para sempre
  });
}

// ——— Atualização ———
async function verificar() {
  if (trocando) return;
  const ramo = (await git("rev-parse", "--abbrev-ref", "HEAD")).saida;
  const f = await git("fetch", "--quiet", "origin", ramo);
  salvarEstado({ verificadoEm: new Date().toISOString(), ramo });
  if (!f.ok) {
    log(`Sem acesso ao GitHub agora (${f.saida.slice(0, 120)}). Tento de novo em 5 minutos.`);
    return;
  }
  const remoto = (await git("rev-parse", `origin/${ramo}`)).saida;
  // Só há o que baixar se o GitHub tiver algo que a máquina ainda não tem
  const temNovo = !(await git("merge-base", "--is-ancestor", remoto, "HEAD")).ok;
  if (temNovo && estado.falhou !== remoto) {
    log("Versão nova no GitHub. Baixando…");
    const antes = (await git("rev-parse", "HEAD:package-lock.json")).saida;
    // Arquivos que o próprio npm/Next reescrevem na máquina: alterados, eles
    // travariam o git pull. Ninguém edita código aqui, então volta ao do GitHub
    await git("checkout", "--", "tsconfig.json", "package-lock.json", "package.json");
    const pull = await git("pull", "--ff-only", "origin", ramo);
    if (!pull.ok) {
      log(`Não consegui baixar: ${pull.saida.slice(0, 300)}`);
      salvarEstado({ falhou: remoto });
      return;
    }
    const depois = (await git("rev-parse", "HEAD:package-lock.json")).saida;
    if (antes !== depois) {
      log("Dependências mudaram. Instalando…");
      await rodar("npm", ["install", "--no-audit", "--no-fund"], { shell: true, mostrar: true });
    }
  }
  const commit = await commitAtual();
  // Já está no ar — ou já falhou e espera a próxima versão
  if (estado.montado === commit || estado.falhou === commit) return;
  await atualizarPara(commit);
}

/** Monta a versão atual do código na pasta livre e troca o painel para ela. */
async function atualizarPara(commit) {
  trocando = true;
  try {
    const livre = estado.pasta === ".next-a" ? ".next-b" : ".next-a";
    if (!(await montar(livre))) {
      salvarEstado({ falhou: commit });
      return;
    }
    await derrubar();
    subir(livre);
    const msg = (await git("log", "-1", "--format=%s")).saida;
    salvarEstado({ pasta: livre, montado: commit, mensagem: msg, atualizadoEm: new Date().toISOString(), falhou: undefined });
    log(`Atualizado: ${msg}`);
  } finally {
    trocando = false;
  }
}

// ——— WhatsApp (WA-AKG) ———
const WA_PASTA = process.env.WAAKG_DIR ?? join(RAIZ, "..", "WA-AKG");
const WA_PORTA = Number(process.env.WAAKG_PORTA) || 3200;
const WA_TSX = join(WA_PASTA, "node_modules", "tsx", "dist", "cli.mjs");
const WA_LOG = join(DADOS, "whatsapp.log");
let wa = null;
let waParando = false;
let waFalhasSeguidas = 0;
let waAvisado = "";

/** Tem alguém ouvindo nessa porta? */
function portaOcupada(porta) {
  return new Promise((resolve) => {
    const s = connect({ port: porta, host: "127.0.0.1" });
    const fim = (r) => {
      s.destroy();
      resolve(r);
    };
    s.once("connect", () => fim(true));
    s.once("error", () => fim(false));
    s.setTimeout(2000, () => fim(false));
  });
}

function avisarUmaVez(chave, msg) {
  if (waAvisado === chave) return;
  waAvisado = chave;
  log(msg);
}

function logWhatsapp(d) {
  try {
    // Guarda no máximo uns 5 MB (mais o arquivo anterior)
    if (existsSync(WA_LOG) && statSync(WA_LOG).size > 5 * 1024 * 1024) renameSync(WA_LOG, WA_LOG + ".1");
    appendFileSync(WA_LOG, d);
  } catch {
    /* log é só ajuda */
  }
}

/**
 * A WA-AKG já está rodando fora daqui? Olha a porta e, no Windows, também os
 * processos: ela conecta os WhatsApps antes de abrir a porta, então nos
 * primeiros segundos só o processo denuncia.
 */
async function whatsappPorFora() {
  if (await portaOcupada(WA_PORTA)) return true;
  if (process.platform !== "win32") return false;
  const r = await rodar("powershell", [
    "-NoProfile",
    "-Command",
    "@(Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -match 'server.index\\.ts' }).Count",
  ]);
  return r.ok && Number(r.saida) > 0;
}

/** Liga a WA-AKG se ela estiver instalada e ninguém mais estiver rodando ela. */
async function cuidarDoWhatsapp() {
  if (wa || waParando) return;
  if (!existsSync(WA_TSX)) return avisarUmaVez("sem", `WhatsApp: a WA-AKG não está instalada em ${WA_PASTA} (rode instalar-whatsapp.cmd). O painel segue sem ela.`);
  // Já está no ar por fora (alguém abriu o iniciar-whatsapp.cmd): não abre outra,
  // porque duas cópias conectariam os mesmos WhatsApps e uma derrubaria a outra
  if (await whatsappPorFora()) return avisarUmaVez("fora", "WhatsApp: a WA-AKG já está rodando por fora (iniciar-whatsapp.cmd); deixo ela como está.");
  if (wa || waParando) return;
  waAvisado = "";
  if (process.platform === "win32") await rodar("net", ["start", "MariaDB"]);
  log(`WhatsApp: subindo a WA-AKG em http://localhost:${WA_PORTA} (o que ela escreve vai para dados\\whatsapp.log)`);
  const env = { ...process.env, NODE_ENV: "production" };
  // Variáveis do painel não podem vazar para ela (a WA-AKG lê as dela do .env)
  for (const k of ["PORT", "NEXT_DIST_DIR", "DADOS_DIR", "HOSTNAME"]) delete env[k];
  const inicio = Date.now();
  const p = spawn(process.execPath, [WA_TSX, "src/server/index.ts"], { cwd: WA_PASTA, env, stdio: ["ignore", "pipe", "pipe"] });
  wa = p;
  p.stdout.on("data", logWhatsapp);
  p.stderr.on("data", logWhatsapp);
  p.on("error", (e) => log(`WhatsApp: não consegui abrir a WA-AKG (${e.message})`));
  p.on("exit", (codigo) => {
    if (wa !== p) return;
    wa = null;
    if (waParando) return;
    // Caindo logo depois de subir, várias vezes: espera mais antes de tentar de novo
    waFalhasSeguidas = Date.now() - inicio < 120000 ? waFalhasSeguidas + 1 : 0;
    const espera = Math.min(10000 * 2 ** waFalhasSeguidas, 5 * 60000);
    log(`WhatsApp: a WA-AKG parou (código ${codigo}). Volto em ${Math.round(espera / 1000)} segundos. Detalhes em dados\\whatsapp.log`);
    setTimeout(() => cuidarDoWhatsapp().catch(() => {}), espera);
  });
}

function pararWhatsapp() {
  waParando = true;
  return new Promise((resolve) => {
    const p = wa;
    if (!p) return resolve();
    p.once("exit", () => resolve());
    p.kill();
    setTimeout(resolve, 8000);
  });
}

// ——— Início ———
async function iniciar() {
  log("Iniciando o painel…");
  // O WhatsApp sobe primeiro: não precisa esperar a montagem do painel
  await cuidarDoWhatsapp().catch((e) => log(`WhatsApp: erro ao subir (${e})`));
  setInterval(() => cuidarDoWhatsapp().catch(() => {}), 60000);
  await verificar().catch((e) => log(`Erro ao verificar: ${e}`));
  const commit = await commitAtual();
  const pasta = estado.pasta;
  if (!servidor) {
    if (pasta && estado.montado === commit && existsSync(join(RAIZ, pasta))) subir(pasta);
    else await atualizarPara(commit);
    if (!servidor && pasta && existsSync(join(RAIZ, pasta))) subir(pasta); // montagem falhou: sobe a última boa
  }
  setInterval(() => verificar().catch((e) => log(`Erro ao verificar: ${e}`)), INTERVALO_MS);
}

for (const sinal of ["SIGINT", "SIGTERM"]) {
  process.on(sinal, async () => {
    trocando = true;
    await Promise.all([derrubar(), pararWhatsapp()]);
    process.exit(0);
  });
}

iniciar();
