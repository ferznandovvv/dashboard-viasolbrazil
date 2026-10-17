/** Leitura do Swagger da TOTVS, para descobrir o contrato de cada endpoint. */

type Esquema = {
  $ref?: string;
  type?: string;
  format?: string;
  items?: Esquema;
  properties?: Record<string, Esquema>;
  required?: string[];
};
type Operacao = {
  requestBody?: { content?: Record<string, { schema?: Esquema }> };
  /** Swagger 2: campos do corpo/formulário vêm como parâmetros */
  parameters?: { name: string; in?: string; required?: boolean; schema?: Esquema; type?: string }[];
  consumes?: string[];
  responses?: Record<string, { content?: Record<string, { schema?: Esquema }> }>;
};
export type SwaggerDoc = {
  paths?: Record<string, Record<string, Operacao>>;
  components?: { schemas?: Record<string, Esquema> };
  definitions?: Record<string, Esquema>;
};

/** Descreve um schema do Swagger em texto indentado, resolvendo os $ref. */
export function descrever(doc: SwaggerDoc, s: Esquema | undefined, nivel = 0, vistos: Set<string> = new Set()): string {
  if (!s || nivel > 3) return "";
  if (s.$ref) {
    const nome = s.$ref.split("/").pop() ?? "";
    if (vistos.has(nome)) return `${"  ".repeat(nivel)}(→ ${nome}, recursivo)`;
    vistos.add(nome);
    const alvo = doc.components?.schemas?.[nome] ?? doc.definitions?.[nome];
    return descrever(doc, alvo, nivel, vistos);
  }
  if (s.type === "array") return descrever(doc, s.items, nivel, vistos);
  if (!s.properties) return `${"  ".repeat(nivel)}(${s.type ?? "?"})`;
  const obrigatorios = new Set(s.required ?? []);
  return Object.entries(s.properties)
    .map(([nome, prop]) => {
      const tipo = prop.$ref ? "objeto" : prop.type === "array" ? "lista" : (prop.type ?? "?");
      const linha = `${"  ".repeat(nivel + 1)}${nome}: ${tipo}${obrigatorios.has(nome) ? "  *obrigatório*" : ""}`;
      const filhos = prop.$ref || prop.type === "array" ? descrever(doc, prop, nivel + 1, new Set(vistos)) : "";
      return filhos ? `${linha}\n${filhos}` : linha;
    })
    .join("\n");
}

/** Corpo aceito por um caminho do Swagger, em texto. */
export function contrato(doc: SwaggerDoc, caminho: string): string {
  const ops = doc.paths?.[caminho];
  if (!ops) return `${caminho}\n  (não existe neste swagger)`;
  const verbo = Object.keys(ops)[0];
  const req = ops[verbo].requestBody?.content?.["application/json"]?.schema;
  return `${verbo.toUpperCase()} ${caminho}\nFILTROS ACEITOS:\n${descrever(doc, req) || "  (sem corpo)"}`;
}

/** O que um caminho do Swagger devolve, em texto. */
export function retorno(doc: SwaggerDoc, caminho: string): string {
  const ops = doc.paths?.[caminho];
  if (!ops) return "";
  const verbo = Object.keys(ops)[0];
  const r = ops[verbo].responses?.["200"]?.content;
  const schema = r?.["application/json"]?.schema ?? Object.values(r ?? {})[0]?.schema;
  return `RESPOSTA:\n${descrever(doc, schema) || "  (sem modelo)"}`;
}


/** Campos que um caminho aceita no corpo e em que formato (formulário ou JSON). */
export function camposDoCorpo(doc: SwaggerDoc, caminho: string): { campos: string[]; formulario: boolean } | null {
  const ops = doc.paths?.[caminho];
  if (!ops) return null;
  const op = ops.post ?? Object.values(ops)[0];
  const resolver = (e?: Esquema): Esquema | undefined => {
    if (!e?.$ref) return e;
    const nome = e.$ref.split("/").pop() ?? "";
    return resolver(doc.components?.schemas?.[nome] ?? doc.definitions?.[nome]);
  };
  const conteudo = op.requestBody?.content ?? {};
  const tipos = Object.keys(conteudo);
  const formulario =
    tipos.some((t) => /form/.test(t)) ||
    (op.consumes ?? []).some((t) => /form/.test(t)) ||
    (op.parameters ?? []).some((p) => p.in === "formData");
  const schema = resolver(conteudo[tipos.find((t) => /form/.test(t)) ?? tipos[0]]?.schema);
  const doBody = (op.parameters ?? []).find((p) => p.in === "body");
  const campos = [
    ...Object.keys(schema?.properties ?? {}),
    ...Object.keys(resolver(doBody?.schema)?.properties ?? {}),
    ...(op.parameters ?? []).filter((p) => p.in === "formData" || p.in === "query").map((p) => p.name),
  ];
  return { campos, formulario };
}
