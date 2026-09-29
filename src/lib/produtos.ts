/**
 * Regras de nome de produto, compartilhadas entre venda e estoque: o
 * cruzamento das duas pontas só fecha se as duas agruparem igual.
 */

const TAMANHOS =
  /^(PP|P|M|G|GG|XG|XGG|XXG|U|UN|UNI|UNICO|ÚNICO|TAM|P\/M|M\/G|G\/GG|\d{1,2})$/i;
const CORES =
  /^(PRETO|PRETA|BRANCO|BRANCA|OFF|WHITE|CRU|BEGE|NUDE|MARROM|CACAU|CAQUI|CEREJA|VINHO|VERMELHO|ROSA|PINK|LILAS|LILÁS|ROXO|AZUL|MARINHO|JEANS|VERDE|OLIVA|MILITAR|AMARELO|MOSTARDA|LARANJA|CORAL|TERRACOTA|PEROLA|PÉROLA|DOURADO|PRATA|CINZA|CHUMBO|GRAFITE|ONCA|ONÇA|ANIMAL|PRINT|ESTAMPADO|ESTAMPADA|FLORAL|LISTRADO|DIVERSOS|DIVERSAS|COLORIDO|MESCLA)$/i;

export interface PartesProduto {
  modelo: string;
  cor: string;
  tamanho: string;
}

/** Separa o nome em modelo, cor e tamanho. */
export function partes(nome: string): PartesProduto {
  const tokens = nome.trim().split(/\s+/);
  let tamanho = "";
  const cores: string[] = [];
  while (tokens.length > 2) {
    const ultimo = tokens[tokens.length - 1];
    if (!tamanho && TAMANHOS.test(ultimo)) {
      tamanho = ultimo.toUpperCase();
      tokens.pop();
      continue;
    }
    if (CORES.test(ultimo) || ultimo.includes("/")) {
      cores.unshift(ultimo);
      tokens.pop();
      continue;
    }
    break;
  }
  return { modelo: tokens.join(" "), cor: cores.join(" "), tamanho };
}

/** Tira sufixos de tamanho e cor para agrupar as variações num só modelo. */
export function modeloDe(nome: string): string {
  return partes(nome).modelo;
}

export type Agrupamento = "modelo" | "cor" | "tamanho" | "completo";

/** Rótulo do produto conforme o agrupamento escolhido na tela. */
export function rotulo(nome: string, agrup: Agrupamento): string {
  const p = partes(nome);
  if (agrup === "completo") return nome.trim();
  if (agrup === "cor") return [p.modelo, p.cor].filter(Boolean).join(" ");
  if (agrup === "tamanho") return [p.modelo, p.tamanho].filter(Boolean).join(" ");
  return p.modelo;
}

/**
 * Categoria do produto a partir do nome, que é como o cadastro identifica a
 * peça ("CALC ZOE OFF WHITE P" → CALC). Alguns nomes começam com duas ou três
 * palavras que só fazem sentido juntas.
 */
const COMPOSTAS = [
  "SAIDA DE PRAIA",
  "SAÍDA DE PRAIA",
  "BODY TULE",
  "CANGA DE PRAIA",
  "KIT PRAIA",
];

export function categoriaDe(nome: string): string {
  const limpo = nome.trim().toUpperCase().replace(/\s+/g, " ");
  for (const c of COMPOSTAS) {
    if (limpo.startsWith(`${c} `) || limpo === c) return c;
  }
  const tokens = limpo.split(" ");
  // Sigla curta sozinha não diz nada: junta com a palavra seguinte
  if (tokens[0] && tokens[0].length <= 2 && tokens[1]) return `${tokens[0]} ${tokens[1]}`;
  return tokens[0] ?? "";
}
