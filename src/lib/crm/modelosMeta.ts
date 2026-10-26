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
  /** `base`: começo fixo do link (padrão: urlBase do site); o final vai como variável */
  botao: { texto: string; exemploSufixo: string; base?: string };
}

const SAIR = "Responda SAIR para não receber mais mensagens";

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
  // Cashback das lojas: assina a vendedora e o botão abre o WhatsApp da loja, pra conversa seguir com ela
  {
    campanha: "cashback_creditado",
    nome: "via_sol_cashback",
    categoria: "UTILITY",
    corpo:
      "Oi {{1}}, tudo bem?\nAqui é a {{2}}, da Via Sol {{3}} ☀️\nVocê ganhou {{4}} de cashback com a sua compra, guardado no seu nome até {{5}}. Ele vale como desconto em compras a partir de {{6}}. Quando vier, me avisa pelo botão abaixo, vou adorar te receber 🧡",
    exemplo: ["Ana", "Valeska", "Fiusa", "R$ 43,35", "23/11", "R$ 217,00"],
    rodape: SAIR,
    botao: { texto: "Falar com a loja", base: "https://wa.me/", exemploSufixo: "5516999999999" },
  },
  {
    campanha: "cashback_site_perto",
    nome: "via_sol_cashback_site_perto",
    categoria: "UTILITY",
    corpo:
      "Oi {{1}}! Aqui é a {{2}}, da Via Sol {{3}} ☀️\nSua compra no nosso site rendeu {{4}} de cashback, válido até {{5}}. No site é só usar o código {{6}} no checkout, e ele vale aqui na loja também, em compras a partir de {{7}}.",
    exemplo: ["Ana", "Pamela", "Centro", "R$ 25,72", "23/11", "F5Y6YP", "R$ 129,00"],
    rodape: SAIR,
    botao: { texto: "Falar com a loja", base: "https://wa.me/", exemploSufixo: "5516999999999" },
  },
  {
    campanha: "cashback_site_longe",
    nome: "via_sol_cashback_site",
    categoria: "UTILITY",
    corpo:
      "Oi {{1}}! Sua compra no site da Via Sol rendeu {{2}} de cashback, válido até {{3}} ☀️\nÉ só usar o código {{4}} no checkout, em compras a partir de {{5}}. Ele também vale nas nossas lojas físicas.",
    exemplo: ["Ana", "R$ 46,08", "23/11", "LHRYN2", "R$ 231,00"],
    rodape: SAIR,
    botao: { texto: "Usar no site", base: "https://viasolbrazil.com.br/discount/", exemploSufixo: "LHRYN2" },
  },
  {
    campanha: "cashback_vencendo",
    nome: "via_sol_cashback_vencendo",
    categoria: "UTILITY",
    corpo:
      "Oi {{1}}! Passando pra lembrar que você tem {{2}} de cashback na Via Sol, que vence em {{3}}. Ele vale como desconto em compras a partir de {{4}}. Se quiser, chama a loja pelo botão abaixo.",
    exemplo: ["Ana", "R$ 30,00", "23/11", "R$ 150,00"],
    rodape: SAIR,
    botao: { texto: "Falar com a loja", base: "https://wa.me/", exemploSufixo: "5516999999999" },
  },
];

/** O corpo do pedido de criação na Graph API. */
export function payloadDoModelo(m: ModeloSugerido, of: ConfigOficial): Record<string, unknown> {
  const site = of.urlBase.endsWith("/") ? of.urlBase : `${of.urlBase}/`;
  const base = m.botao.base ?? site;
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
