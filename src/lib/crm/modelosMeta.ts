/**
 * Modelos sugeridos para a Meta (carrinho abandonado e Pix não pago). O
 * painel manda para aprovação com um clique; o texto aqui é o mesmo do
 * espelho em MODELOS_PADRAO, com {{1}}, {{2}}... no lugar das variáveis.
 */

import type { ConfigOficial, TipoCampanha } from "./tipos";

export interface ModeloSugerido {
  campanha: TipoCampanha;
  nome: string;
  categoria: "MARKETING" | "UTILITY";
  corpo: string;
  exemplo: string[];
  rodape?: string;
  botao: { texto: string; exemploSufixo: string };
}

export const MODELOS_SUGERIDOS: ModeloSugerido[] = [
  {
    campanha: "carrinho_abandonado",
    nome: "via_sol_carrinho",
    categoria: "MARKETING",
    corpo:
      "Oi {{1}}! Vimos que você deixou {{2}} no carrinho da Via Sol ☀️ Ele continua guardado pra você, é só tocar no botão pra finalizar. Se ficou alguma dúvida de tamanho ou modelo, responde aqui que a gente te ajuda.",
    exemplo: ["Ana", "Biquíni Marina e mais 1 peça"],
    rodape: "Responda SAIR para não receber mais mensagens",
    botao: { texto: "Finalizar compra", exemploSufixo: "1234567/checkouts/ac/abc123/recover?key=xyz" },
  },
  {
    campanha: "pix_pendente",
    nome: "via_sol_pix_pendente",
    categoria: "UTILITY",
    corpo:
      "Oi {{1}}, seu pedido {{2}} na Via Sol está reservado, mas o Pix de {{3}} ainda não foi pago. Pra garantir as peças, é só abrir o pedido no botão abaixo e pagar. Se teve algum problema com o pagamento, responde aqui que a gente resolve.",
    exemplo: ["Ana", "#12345", "R$ 289,90"],
    botao: { texto: "Ver pedido", exemploSufixo: "1234567/orders/abc123/authenticate?key=xyz" },
  },
];

/** O corpo do pedido de criação na Graph API. */
export function payloadDoModelo(m: ModeloSugerido, of: ConfigOficial): Record<string, unknown> {
  const base = of.urlBase.endsWith("/") ? of.urlBase : `${of.urlBase}/`;
  return {
    name: m.nome,
    language: "pt_BR",
    category: m.categoria,
    components: [
      { type: "BODY", text: m.corpo, example: { body_text: [m.exemplo] } },
      ...(m.rodape ? [{ type: "FOOTER", text: m.rodape }] : []),
      { type: "BUTTONS", buttons: [{ type: "URL", text: m.botao.texto, url: `${base}{{1}}`, example: [`${base}${m.botao.exemploSufixo}`] }] },
    ],
  };
}
