# Dashboard de Vendas Online — Via Sol Brazil

Dashboard unificado das vendas online da Via Sol Brazil, juntando três canais:

- 🛍️ **Shopify** (loja própria — viasolbrazil.com.br)
- 🎵 **TikTok Shop**
- 🤝 **Mercado Livre**

Mostra faturamento, pedidos, ticket médio, gráfico diário por canal e os
últimos pedidos, com filtros de 7 / 30 / 90 dias. Tudo em BRL, no fuso de
São Paulo.

## Como funciona

- **Next.js (App Router)** — o front busca `/api/dashboard`, que consulta as
  APIs dos três canais em paralelo e devolve tudo normalizado.
- Cada canal só é consultado se as credenciais dele estiverem configuradas.
  Canal sem credencial aparece como **"não conectado"** no dashboard, com a
  lista de variáveis que faltam — o resto continua funcionando normalmente.
- Proteção por senha opcional via `DASHBOARD_PASSWORD`.

## Rodando localmente

```bash
cp .env.example .env.local   # preencha as credenciais
npm install
npm run dev
```

## Deploy (Vercel)

O projeto está pronto para a Vercel. Depois do deploy, configure as variáveis
de ambiente em **Settings → Environment Variables** (as mesmas do
`.env.example`) e faça um redeploy.

## Conectando cada canal

### Shopify
1. Admin da loja → **Configurações → Apps e canais de vendas → Desenvolver apps**
2. **Criar app** (ex.: "Dashboard Vendas") → Configurar escopos da Admin API →
   marque `read_orders`
3. **Instalar app** e copie o **Admin API access token** (`shpat_…`)
4. Preencha `SHOPIFY_ADMIN_TOKEN` (o `SHOPIFY_STORE_DOMAIN` já está no exemplo)

### Mercado Livre
1. Crie uma aplicação em [developers.mercadolivre.com.br](https://developers.mercadolivre.com.br)
2. Faça o fluxo OAuth uma vez para obter o `refresh_token` da conta vendedora
3. Preencha `ML_CLIENT_ID`, `ML_CLIENT_SECRET` e `ML_REFRESH_TOKEN` —
   o dashboard renova o access token sozinho

### TikTok Shop
1. Crie um app no [TikTok Shop Partner Center](https://partner.tiktokshop.com)
2. Autorize a loja e copie `TIKTOK_APP_KEY`, `TIKTOK_APP_SECRET`,
   `TIKTOK_ACCESS_TOKEN` e `TIKTOK_SHOP_CIPHER`
