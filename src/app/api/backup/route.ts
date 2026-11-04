import { NextResponse } from "next/server";
import { lerBase as lerCrm } from "@/lib/crm/base";
import { lerBase as lerFin } from "@/lib/financeiro/base";
import { pastaDeBackupPadrao, situacaoDoBackup } from "@/lib/pastaBackup";

export const dynamic = "force-dynamic";

const esc = (t: unknown) => String(t ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;");
const quando = (ms: number) => new Date(ms).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
const mb = (b: number) => `${(b / 1048576).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB`;

/** Onde estão as cópias de segurança do CRM e do financeiro, e as mais novas (só o dono). */
export async function GET() {
  const [crm, fin, padrao] = await Promise.all([lerCrm().catch(() => null), lerFin().catch(() => null), pastaDeBackupPadrao()]);
  const blocos = await Promise.all(
    [
      { nome: "CRM", pasta: crm?.config.backupDir, prefixo: "crm" as const },
      { nome: "Financeiro", pasta: fin?.config.backupDir, prefixo: "financeiro" as const },
    ].map(async (b) => {
      const s = await situacaoDoBackup(b.pasta, b.prefixo);
      const nuvem = /Drive|OneDrive/i.test(s.pasta);
      const ult = s.copias[0];
      return `<h2>${b.nome}</h2>${
        !s.pasta
          ? `<p class="erro">Sem pasta de backup. Ela é configurada sozinha uns minutos depois que o painel reinicia.</p>`
          : `<p>Pasta: <code>${esc(s.pasta)}</code> ${nuvem ? `<span class="ok">· na nuvem</span>` : `<span class="aviso">· só neste computador</span>`}</p>
<p>${ult ? `Cópia mais nova: <b>${esc(ult.nome)}</b>, de ${quando(ult.em)} (${mb(ult.tamanho)}). ${s.copias.length === 1 ? "1 cópia guardada" : `${s.copias.length} cópias guardadas`}.` : `<span class="aviso">Nenhuma cópia ainda${s.existe ? "" : " (a pasta ainda não existe)"}: a primeira sai na próxima alteração.</span>`}</p>`
      }`;
    })
  );
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>Backup</title><style>
body{font-family:system-ui,sans-serif;background:#f9f9f7;color:#0b0b0b;padding:20px 12px;max-width:760px;margin:0 auto}
h1{font-size:18px;margin:0 0 6px}h2{font-size:14px;margin:18px 0 4px;color:#9a4510}p{font-size:13.5px;color:#3d3c39;margin:4px 0;line-height:1.5}
code{font-size:12px;word-break:break-all}.ok{color:#006300;font-weight:600}.aviso{color:#9a4510;font-weight:600}.erro{color:#b42318;font-weight:600}
</style></head><body><h1>Cópias de segurança</h1>
<p>Uma cópia por dia de cada base, atualizada a cada 30 minutos de uso; ficam as dos últimos 60 dias. Para trocar a pasta: CRM › Configurações e Financeiro › Cadastros.</p>
${blocos.join("")}
${padrao.nuvem ? "" : `<p class="aviso" style="margin-top:16px">Não achei Google Drive nem OneDrive neste computador, então as cópias ficam em Documentos: protegem de arquivo estragado, mas não de o computador quebrar. Instalando o Google Drive para computador, troque a pasta para dentro dele.</p>`}
</body></html>`;
  return new NextResponse(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}
