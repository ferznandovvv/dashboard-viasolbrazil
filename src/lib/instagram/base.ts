/**
 * Robô do Instagram (comentou a palavra, recebe o link no direct).
 * Tudo fica em dados/instagram/base.json, com a mesma fila única de escrita do CRM.
 * Só roda no servidor Node.
 */

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

const PASTA = join(process.env.DADOS_DIR ?? join(process.cwd(), "dados"), "instagram");
const ARQUIVO = join(PASTA, "base.json");

export type Origem = "live" | "post" | "reel" | "anuncio";

export interface ConfigInstagram {
  /** Liga e desliga o robô inteiro */
  ativo: boolean;
  /** Palavras que disparam (sem acento e sem diferença de maiúscula). Ex.: quero */
  palavras: string[];
  /** Responde também comentário em post e reel (não só na live) */
  postsTambem: boolean;
  /** Texto da DM. {link} vira o link com UTM da origem; {nome} vira o @ de quem comentou */
  mensagem: string;
  /** Link de destino, sem UTM (o robô coloca utm_source/medium/campaign) */
  link: string;
  /** utm_campaign */
  campanha: string;
  /** Token da conta (Instagram Login), id e @ dela */
  token: string;
  tokenExpiraEm?: string;
  igUserId: string;
  usuario: string;
  /** Segredo do app (Instagram) pra conferir a assinatura do webhook */
  appSecret: string;
  /** Token de verificação do webhook (vai na tela da Meta) */
  verifyToken: string;
  /** Vigia da live (busca os comentários a cada 3 s): fica ligada até esta hora */
  vigiaAte?: string;
}

export interface Resposta {
  commentId: string;
  em: string;
  usuario: string;
  userId: string;
  texto: string;
  origem: Origem;
  mediaId: string;
  /** enviado | ignorado (já recebeu, palavra não bate…) | erro */
  status: "enviado" | "erro" | "repetido";
  detalhe?: string;
  /** Como chegou: webhook ou vigia */
  via: "webhook" | "vigia" | "teste";
}

export interface BaseInstagram {
  config: ConfigInstagram;
  respostas: Resposta[];
  /** Quem já recebeu em cada mídia (live/post): não manda duas vezes pra mesma pessoa */
  jaRecebeu: Record<string, string[]>;
  /** Últimos avisos crus do webhook, pra diagnóstico */
  ultimosEventos: { em: string; campo: string; resumo: string }[];
}

export const LINK_PADRAO = "https://www.viasolbrazil.com.br/collections/black-november";

export const MENSAGEM_PADRAO =
  "Oi, {nome}! Aqui está o link da Black November da Via Sol 🖤\n\n" +
  "1 peça sai por R$59, 2 peças por R$49 cada e 3 ou mais por R$39 cada, no Pix. Top e calcinha são vendidos avulsos, então dá pra montar do seu jeito.\n\n" +
  "{link}";

function inicial(): BaseInstagram {
  return {
    config: {
      ativo: false,
      palavras: ["quero"],
      postsTambem: true,
      mensagem: MENSAGEM_PADRAO,
      link: LINK_PADRAO,
      campanha: "black_november",
      token: "",
      igUserId: "",
      usuario: "",
      appSecret: "",
      verifyToken: randomBytes(12).toString("hex"),
    },
    respostas: [],
    jaRecebeu: {},
    ultimosEventos: [],
  };
}

const g = globalThis as unknown as { __filaIg?: Promise<unknown> };

async function ler(): Promise<BaseInstagram> {
  try {
    const b = JSON.parse(await readFile(ARQUIVO, "utf8")) as BaseInstagram;
    const ini = inicial();
    b.config = { ...ini.config, ...b.config };
    b.respostas ??= [];
    b.jaRecebeu ??= {};
    b.ultimosEventos ??= [];
    return b;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    const b = inicial();
    await gravar(b);
    return b;
  }
}

async function gravar(b: BaseInstagram): Promise<void> {
  await mkdir(PASTA, { recursive: true });
  const tmp = `${ARQUIVO}.tmp`;
  await writeFile(tmp, JSON.stringify(b), "utf8");
  await rename(tmp, ARQUIVO);
}

/** Leitura passa pela fila também: nunca lê no meio de uma gravação. */
export function lerBaseIg(): Promise<BaseInstagram> {
  const p = (g.__filaIg ?? Promise.resolve()).then(ler);
  g.__filaIg = p.catch(() => {});
  return p;
}

export function alterarBaseIg<T>(fn: (b: BaseInstagram) => T | Promise<T>): Promise<T> {
  const p = (g.__filaIg ?? Promise.resolve()).then(async () => {
    const b = await ler();
    const r = await fn(b);
    // Guarda só o recente: 3000 respostas e 60 mídias
    if (b.respostas.length > 3000) b.respostas = b.respostas.slice(-3000);
    const midias = Object.keys(b.jaRecebeu);
    if (midias.length > 60) for (const m of midias.slice(0, midias.length - 60)) delete b.jaRecebeu[m];
    if (b.ultimosEventos.length > 40) b.ultimosEventos = b.ultimosEventos.slice(-40);
    await gravar(b);
    return r;
  });
  g.__filaIg = p.catch(() => {});
  return p;
}
