/**
 * Quem vê o quê. Arquivo sem dependências de servidor: o porteiro (middleware),
 * as rotas e o menu usam as mesmas regras.
 */

export type Papel = "dono" | "socia" | "financeiro" | "loja";

/** Partes do sistema que um papel pode abrir */
export type Area = "vendas" | "produtos" | "estoque" | "financeiro" | "crm" | "loja" | "tv" | "config";

export const PAPEIS: Record<Papel, { nome: string; explica: string }> = {
  dono: { nome: "Dono", explica: "Vê e mexe em tudo, inclusive nas Configurações." },
  socia: {
    nome: "Sócia",
    explica: "Vê vendas, produtos, financeiro, CRM e as telas das lojas. Não mexe nas Configurações.",
  },
  financeiro: { nome: "Financeiro", explica: "Lança e paga contas. Vê o DRE se você liberar." },
  loja: {
    nome: "Loja",
    explica: "Usuário do computador da loja: tela da loja, caixa e cashback, só da própria loja.",
  },
};

const AREAS: Record<Papel, Area[]> = {
  dono: ["vendas", "produtos", "estoque", "financeiro", "crm", "loja", "tv", "config"],
  socia: ["vendas", "produtos", "estoque", "financeiro", "crm", "loja", "tv"],
  financeiro: ["financeiro"],
  // Sem estoque por enquanto: o saldo da TOTVS ainda tem divergência (pedido do Fernando)
  loja: ["loja"],
};

export const temArea = (papel: Papel, area: Area) => AREAS[papel].includes(area);

/** Para onde cada papel vai ao entrar (ou quando abre algo que não pode) */
export function inicio(papel: Papel): string {
  if (papel === "financeiro") return "/financeiro";
  if (papel === "loja") return "/crm/loja";
  return "/";
}

/** A sócia acompanha o CRM, mas campanhas e configurações dele ficam com o dono */
export const soLeitura = (papel: Papel, area: Area) => papel === "socia" && area === "crm";

/** Abertas para qualquer um: entrar, o aquecimento agendado, o webhook do WhatsApp e o logo */
export function publica(caminho: string): boolean {
  return (
    caminho === "/login" ||
    caminho === "/api/login" ||
    caminho === "/api/aquecer" ||
    caminho === "/api/crm/webhook" ||
    // A portaria da WA-AKG confere o passe de entrada (uso único, 1 minuto)
    caminho === "/whats/validar" ||
    /^\/(logo-[a-z]+|icon)\.png$/.test(caminho)
  );
}

/** Telas de aparelho que aceitam o código da TV na URL (?k=), sem login */
export const ROTAS_DE_APARELHO = ["/tv", "/api/tv", "/loja", "/api/loja", "/crm/loja", "/api/crm/loja"];

/**
 * A parte do sistema de cada endereço. `null` quer dizer "basta estar logado".
 * Rota de API que não está na lista fica só com o dono (integrações,
 * diagnósticos, contas de acesso).
 */
export function areaDaRota(caminho: string, metodo: string, busca: URLSearchParams): Area | null {
  const em = (pre: string) => caminho === pre || caminho.startsWith(pre + "/");
  if (em("/crm/loja") || em("/api/crm/loja") || em("/loja") || em("/api/loja")) return "loja";
  if (em("/tv") || em("/api/tv")) return "tv";
  if (em("/financeiro") || em("/api/financeiro")) return "financeiro";
  if (em("/crm") || em("/api/crm") || em("/atendimento")) return "crm";
  if (em("/api/produtos")) return busca.get("modo") === "vendidos" ? "produtos" : "estoque";
  if (em("/produtos")) return "estoque";
  if (caminho === "/" || em("/api/dashboard") || em("/historico") || em("/api/historico")) return "vendas";
  // Metas: ler aparece em Vendas; mudar é configuração
  if (em("/api/config")) return metodo === "GET" ? "vendas" : "config";
  if (em("/api/acesso/eu")) return null;
  if (em("/configurar") || caminho.startsWith("/api/")) return "config";
  return null;
}
