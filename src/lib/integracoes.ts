/**
 * O que cada integração precisa. A tela de configuração é montada a partir
 * daqui, e a rota que salva só aceita estes nomes.
 */
export interface Integracao {
  id: string;
  nome: string;
  /** Para que serve, em uma linha */
  para: string;
  /** Chaves que a pessoa cola */
  campos: { nome: string; rotulo: string; dica?: string }[];
  /** Chaves que a autorização gera sozinha */
  geradas?: string[];
  /** Tela que faz a autorização, quando há */
  autorizar?: string;
}

export const INTEGRACOES: Integracao[] = [
  {
    id: "totvs",
    nome: "TOTVS — lojas físicas",
    para: "Vendas, vendedoras e estoque das 8 lojas",
    campos: [
      { nome: "TOTVS_CLIENT_ID", rotulo: "Client ID", dica: "Tela LOGFC006 do TOTVS" },
      { nome: "TOTVS_CLIENT_SECRET", rotulo: "Client secret", dica: "Tela LOGFC006 do TOTVS" },
      { nome: "TOTVS_USERNAME", rotulo: "Usuário", dica: "Usuário do TOTVS (ADMFM026)" },
      { nome: "TOTVS_PASSWORD", rotulo: "Senha", dica: "Senha desse usuário" },
    ],
  },
  {
    id: "shopify",
    nome: "Shopify — site",
    para: "Pedidos pagos do site",
    campos: [
      {
        nome: "SHOPIFY_ADMIN_TOKEN",
        rotulo: "Token de acesso (shpat_…)",
        dica: "Admin da Shopify → Apps → Desenvolver apps → seu app → Credenciais da API",
      },
    ],
  },
  {
    id: "tiktok",
    nome: "TikTok Shop",
    para: "Pedidos do TikTok Shop",
    campos: [
      { nome: "TIKTOK_APP_KEY", rotulo: "App key", dica: "partner.tiktokshop.com → seu app" },
      { nome: "TIKTOK_APP_SECRET", rotulo: "App secret", dica: "partner.tiktokshop.com → seu app" },
    ],
    geradas: ["TIKTOK_REFRESH_TOKEN", "TIKTOK_SHOP_CIPHER"],
    autorizar: "/api/tiktok/setup",
  },
  {
    id: "meli",
    nome: "Mercado Livre",
    para: "Pedidos do Mercado Livre",
    campos: [
      { nome: "ML_CLIENT_ID", rotulo: "Client ID", dica: "developers.mercadolivre.com.br → Suas aplicações" },
      { nome: "ML_CLIENT_SECRET", rotulo: "Client secret", dica: "developers.mercadolivre.com.br → Suas aplicações" },
    ],
    geradas: ["ML_REFRESH_TOKEN"],
    autorizar: "/api/meli/setup",
  },
  {
    id: "tiktok-ads",
    nome: "TikTok Ads",
    para: "Gasto de anúncios do TikTok",
    campos: [
      { nome: "TIKTOK_ADS_APP_ID", rotulo: "App ID", dica: "business-api.tiktok.com/portal/apps" },
      { nome: "TIKTOK_ADS_APP_SECRET", rotulo: "Secret", dica: "business-api.tiktok.com/portal/apps" },
    ],
    geradas: ["TIKTOK_ADS_ACCESS_TOKEN", "TIKTOK_ADS_ADVERTISER_ID"],
    autorizar: "/api/tiktok-ads/setup",
  },
  {
    id: "meta",
    nome: "Meta Ads",
    para: "Gasto de anúncios do Facebook e Instagram",
    campos: [
      {
        nome: "META_ACCESS_TOKEN",
        rotulo: "Token (ads_read)",
        dica: "Business Manager → Usuários do sistema → Gerar token",
      },
    ],
  },
];

export const NOMES_PERMITIDOS = new Set(
  INTEGRACOES.flatMap((i) => [...i.campos.map((c) => c.nome), ...(i.geradas ?? [])])
);
