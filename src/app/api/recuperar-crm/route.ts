import { NextRequest, NextResponse } from "next/server";
import { open, readFile, readdir, rename, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { gravarSeguro } from "@/lib/arquivoSeguro";
import { ARQUIVO_BASE_CRM, baseValida, copiasDaBase } from "@/lib/crm/base";
import { registrarErro } from "@/lib/registroDeErros";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Pastas que não têm cópia da base e só atrasam a busca */
const PULAR = /^(node_modules|\.git|\.next.*|AppData|\$Recycle\.Bin|Windows|Program Files.*|ProgramData|System Volume Information|WA-AKG)$/i;
const COPIA = /^crm-\d{4}-\d{2}-\d{2}\.json$/;

interface Achado {
  arquivo: string;
  em: number;
  tamanho: number;
  zerado?: boolean;
  clientes?: number;
  vendas?: number;
  ultimaVenda?: string;
  cashback?: number;
}

/** Procura cópias da base do CRM: crm-AAAA-MM-DD.json em qualquer lugar e base.json* em pastas "crm". */
async function varrer(pasta: string, nivel: number, achados: Set<string>, ate: number) {
  if (nivel < 0 || Date.now() > ate) return;
  const itens = await readdir(pasta, { withFileTypes: true }).catch(() => []);
  for (const it of itens) {
    const p = join(pasta, it.name);
    if (it.isDirectory()) {
      if (!PULAR.test(it.name)) await varrer(p, nivel - 1, achados, ate);
    } else if (COPIA.test(it.name) || (/^base\.json/.test(it.name) && basename(pasta).toLowerCase() === "crm")) achados.add(p);
  }
}

async function examinar(arquivo: string): Promise<Achado | null> {
  const st = await stat(arquivo).catch(() => null);
  if (!st || !st.isFile() || st.size < 2) return null;
  const a: Achado = { arquivo, em: st.mtimeMs, tamanho: st.size };
  // Primeiro byte zero: estragou igual à base
  const fh = await open(arquivo, "r");
  const b = Buffer.alloc(1);
  await fh.read(b, 0, 1, 0).finally(() => fh.close());
  if (b[0] === 0) return { ...a, zerado: true };
  try {
    const base = JSON.parse(await readFile(arquivo, "utf8")) as { clientes: unknown[]; vendas: { data?: string }[]; cashback?: unknown[] };
    if (!baseValida(base)) return null;
    return {
      ...a,
      clientes: base.clientes.length,
      vendas: base.vendas.length,
      cashback: base.cashback?.length ?? 0,
      ultimaVenda: base.vendas.reduce((m, v) => ((v.data ?? "") > m ? (v.data ?? "") : m), ""),
    };
  } catch {
    return { ...a, zerado: true };
  }
}

/**
 * Versões anteriores do Windows (pontos de restauração): a mesma base dentro
 * de cada cópia de sombra do disco, se a proteção do sistema estiver ligada.
 */
async function nasVersoesAnteriores(): Promise<string[]> {
  if (process.platform !== "win32") return [];
  const semDisco = ARQUIVO_BASE_CRM.replace(/^[A-Za-z]:\\/, "");
  const nomes = ["base.json", "base.json.tmp", "base.json.bak"].map((n) => join(dirname(semDisco), n));
  const out: string[] = [];
  for (let i = 1; i <= 120; i++) {
    for (const n of nomes) {
      const p = `\\\\?\\GLOBALROOT\\Device\\HarddiskVolumeShadowCopy${i}\\${n}`;
      if (await stat(p).then(() => true).catch(() => false)) out.push(p);
    }
  }
  return out;
}

async function procurar(): Promise<Achado[]> {
  const achados = new Set<string>(await copiasDaBase().catch(() => []));
  for (const p of await nasVersoesAnteriores().catch(() => [])) achados.add(p);
  const ate = Date.now() + 40000;
  await varrer(dirname(ARQUIVO_BASE_CRM), 0, achados, ate);
  await varrer(homedir(), 7, achados, ate);
  for (const letra of "CDEFGHIJ") await varrer(`${letra}:\\`, 4, achados, ate);
  // Só as 12 mais recentes: a pasta de backup guarda até 60 cópias, e abrir todas demora
  const recentes = (await Promise.all(Array.from(achados).filter((f) => f !== ARQUIVO_BASE_CRM).map(async (f) => ({ f, t: (await stat(f).catch(() => null))?.mtimeMs ?? -1 }))))
    .filter((x) => x.t >= 0)
    .sort((x, y) => y.t - x.t)
    .slice(0, 12);
  const lista = (await Promise.all(recentes.map((x) => examinar(x.f).catch(() => null)))).filter((x): x is Achado => Boolean(x));
  return lista.sort((x, y) => (y.ultimaVenda ?? "").localeCompare(x.ultimaVenda ?? "") || y.em - x.em);
}

const esc = (t: unknown) => String(t ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
const quando = (ms: number) => new Date(ms).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });

function pagina(corpo: string) {
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>Recuperar o CRM</title><style>
body{font-family:system-ui,sans-serif;background:#f9f9f7;color:#0b0b0b;padding:20px 12px;max-width:900px;margin:0 auto}
h1{font-size:18px;margin:0 0 6px}p,li{font-size:13.5px;color:#3d3c39;line-height:1.5}
table{width:100%;border-collapse:collapse;font-size:12.5px;margin:10px 0}th{text-align:left;color:#52514e;border-bottom:1px solid #bbb;padding:5px 6px}
td{padding:6px;border-bottom:1px solid #e1e0d9;vertical-align:top}td.n{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
code{font-size:11.5px;word-break:break-all}button{font:inherit;font-weight:600;padding:6px 12px;border-radius:8px;border:1px solid #9a4510;background:#bc5714;color:#fff;cursor:pointer}
.ok{color:#006300;font-weight:600}.erro{color:#b42318;font-weight:600}.muted{color:#6b6a66}
</style></head><body><h1>Recuperar a base do CRM</h1>${corpo}</body></html>`;
  return new NextResponse(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

/**
 * Procura no computador as cópias da base do CRM (backup diário, versão
 * anterior, temporário) e mostra o que cada uma tem, a mais nova primeiro.
 * Só o dono abre (rota de API fora da lista de áreas).
 */
export async function GET() {
  const lista = await procurar();
  const boas = lista.filter((a) => !a.zerado);
  const zeradas = lista.length - boas.length;
  const linhas = boas
    .map(
      (a) => `<tr><td>${a.arquivo.includes("ShadowCopy") ? "<b>Versão anterior do Windows</b><br>" : ""}<code>${esc(a.arquivo)}</code><br><span class="muted">salvo em ${quando(a.em)}</span></td>
<td class="n">${a.ultimaVenda ? esc(a.ultimaVenda.slice(0, 16).replace("T", " ")) : "—"}</td><td class="n">${a.clientes}</td><td class="n">${a.vendas}</td>
<td><form method="post"><input type="hidden" name="arquivo" value="${esc(a.arquivo)}"><button>Usar esta</button></form></td></tr>`
    )
    .join("");
  return pagina(`
<p>A base do CRM está em <code>${esc(ARQUIVO_BASE_CRM)}</code>. Procurei cópias no computador (pasta do usuário, discos e versões anteriores do Windows). A mais nova vem primeiro: veja a data da última venda.</p>
${
  boas.length
    ? `<table><tr><th>Cópia</th><th class="n">Última venda</th><th class="n">Clientes</th><th class="n">Vendas</th><th></th></tr>${linhas}</table>
<p>Ao usar uma cópia, o arquivo estragado fica guardado ao lado (não é apagado). O que aconteceu depois da cópia (vendas da TOTVS) volta na próxima sincronização.</p>`
    : `<p class="erro">Não achei nenhuma cópia boa${zeradas ? ` (achei ${zeradas} estragada${zeradas > 1 ? "s" : ""}, também zerada${zeradas > 1 ? "s" : ""})` : ""}.</p>
<p>Também não há versão anterior do Windows guardada (a proteção do sistema está desligada, ou nenhum ponto de restauração pegou esse arquivo).</p>`
}`);
}

/** Usa a cópia escolhida: confere de novo, guarda o estragado e grava. */
export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null);
  const arquivo = String(form?.get("arquivo") ?? "");
  const a = arquivo ? await examinar(arquivo).catch(() => null) : null;
  if (!a || a.zerado) return pagina(`<p class="erro">Essa cópia não serve (não abre ou não é uma base do CRM).</p><p><a href="/api/recuperar-crm">Voltar</a></p>`);
  const carimbo = new Date().toISOString().replace(/[:.]/g, "-");
  await rename(ARQUIVO_BASE_CRM, `${ARQUIVO_BASE_CRM}.corrompido-${carimbo}`).catch(() => {});
  await gravarSeguro(ARQUIVO_BASE_CRM, await readFile(arquivo, "utf8"));
  await registrarErro(`base do CRM restaurada à mão da cópia ${arquivo} (salva em ${quando(a.em)})`, "recuperado pela página /api/recuperar-crm");
  return pagina(`<p class="ok">Pronto: a base do CRM voltou da cópia salva em ${quando(a.em)} (${a.clientes} clientes, ${a.vendas} vendas, última venda ${esc(
    (a.ultimaVenda ?? "").slice(0, 16).replace("T", " ")
  )}).</p><p>O arquivo estragado ficou guardado como <code>base.json.corrompido-${carimbo}</code>.</p><p><a href="/crm/loja">Abrir a tela da loja</a></p>`);
}
