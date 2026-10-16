# CRM das lojas físicas

Aba **CRM** do painel: base de clientes das lojas, cashback e mensagens de
WhatsApp (cashback creditado, vencimento, aniversário, pós-venda,
reativação). Roda no computador da empresa, como o financeiro: tudo fica em
`dados/crm/base.json`, com cópia diária na pasta de backup que você escolher.

## Como as peças se encaixam

```
TOTVS (notas + cadastro)  ──sincronização 8h30──►  base de clientes e vendas
CSV (planilha)            ──importação manual────►  (mesma base)
Caixa da loja (/crm/loja) ──cadastro na hora─────►  (mesma base)
                                                        │
                                           automações do dia (9h12)
                                                        │
                                                   fila de envio
                                        (teto por número, horário, intervalo)
                                                        │
                                             WA-AKG ou Cloud API
                                                        │
                                       webhook de respostas e status
```

Quem manda é a fila, nunca a campanha. É ela que protege os números:

- um teto de mensagens por número por dia (começa em 20);
- só em horário comercial, nos dias marcados;
- intervalo aleatório entre mensagens do mesmo número (1 a 4 minutos);
- cada loja manda só para as próprias clientes, pelo próprio número;
- quem responde **SAIR** nunca mais recebe; quem não responde a 2 campanhas
  de marketing seguidas só recebe avisos de cashback.

## Primeira vez

1. **Subir o painel** com a versão nova (o `iniciar-painel.cmd` atualiza
   sozinho). Abra `/crm`.
2. **Conferir a API do TOTVS**: aba Importar → "Diagnóstico da API do TOTVS"
   → Consultar. Olhe se a nota traz `personCode` e se o cadastro traz
   telefone e `birthDate`. Os nomes de campo da API não estão todos
   documentados; se vierem com outro nome, me mostre o resultado que eu
   ajusto o mapeamento em `src/lib/crm/totvs.ts` (função `lerPessoa`).
3. **Carga histórica**: Visão geral → card TOTVS → "carga histórica…". Um ano
   é um bom começo. Não gera cashback do passado, só preenche quem é cliente
   e quanto gastou. Leva alguns minutos; a tela mostra o andamento.
4. **Regras**: Configurar → Cashback. Percentual, validade, mínimo para
   resgatar e teto por compra.
5. **WhatsApp**: veja abaixo.

## WA-AKG na mesma máquina

A WA-AKG (<https://github.com/mrifqidaffaaditya/WA-AKG>) é um gateway não
oficial em cima do Baileys. Funciona como o WhatsApp Web: o servidor vira um
dispositivo pareado do número da loja; o celular continua funcionando normal.

```bash
git clone https://github.com/mrifqidaffaaditya/WA-AKG.git
cd WA-AKG
npm install
copy .env.example .env     # DATABASE_URL (MySQL ou Postgres local), AUTH_SECRET, PORT=3000
npm run db:push
npm run make-admin seu@email.com uma-senha
npm run build
pm2 start ecosystem.config.js && pm2 save
```

Depois, em <http://localhost:3000>:

1. Crie uma **sessão por loja** (ex.: `centro`, `fiusa`) e escaneie o QR no
   celular da loja em *Dispositivos conectados*.
2. Pegue a **API Key** do usuário.
3. Em **Webhooks**, cadastre a URL que aparece em CRM → Configurar → Envio
   (pode usar `http://localhost:3100/api/crm/webhook?t=...` já que está na
   mesma máquina), eventos `message.received` e `message.status`.

No painel, Configurar → Envio: provedor WA-AKG, endereço
`http://localhost:3000`, API Key. Em Números, cole o `sessionId` de cada
loja, ligue e teste ("situação" e "mandar teste" para o seu celular).

Comece com uma ou duas lojas e teto baixo. Se der problema de conexão
repetido, o adaptador da Cloud API (oficial) está pronto em
`src/lib/crm/envio/cloudApi.ts`: é trocar o provedor e colar o token e os
`phone_number_id`. Lembre que fora da janela de 24h a oficial só aceita
template aprovado, então as campanhas precisariam ser cadastradas na Meta.

## Caixa da loja

`/crm/loja?k=CODIGO` (o mesmo `TV_CODE` da tela de metas). No celular ou
tablet da loja: buscar a cliente por celular, CPF ou nome; cadastrar na hora
com o aceite de mensagens; ver saldo; registrar resgate. O resgate aqui só
registra no CRM, o desconto na venda do TOTVS continua sendo lançado pela
vendedora.

A cliente também pode receber um **código de resgate** gerado na ficha dela
(vale 7 dias, uma vez só): ela mostra no caixa, a vendedora digita, e o
sistema confere.

## Automações

Rodam uma vez por dia, no horário configurado (depois da sincronização com o
TOTVS). Só colocam mensagens na fila:

| Campanha | Quando | Tipo |
| --- | --- | --- |
| Boas-vindas | cadastro novo no caixa com aceite | aviso |
| Cashback creditado | até 3 dias depois do crédito | aviso |
| Cashback vencendo | X dias antes de expirar | aviso |
| Aniversário | no dia | marketing |
| Pós-venda | X dias depois da compra (desligada por padrão) | aviso |
| Reativação | sem comprar há X dias e gastou acima de Y; no máximo 10 por loja por dia | marketing |

Os textos têm variações (sorteadas) e aceitam `{primeiro}`, `{nome}`,
`{loja}`, `{valor}`, `{validade}`, `{codigo}`. Edite em Configurar → Textos.

## Arquivos

- `src/lib/crm/tipos.ts` tipos, campanhas e textos padrão
- `src/lib/crm/base.ts` leitura/escrita de `dados/crm/base.json`
- `src/lib/crm/clientes.ts` cadastro, deduplicação, segmentos
- `src/lib/crm/cashback.ts` extrato, crédito, expiração, resgate, códigos
- `src/lib/crm/totvs.ts` sincronização e diagnóstico da API
- `src/lib/crm/importar.ts` CSV
- `src/lib/crm/mensagens.ts` modelos e entrada na fila
- `src/lib/crm/fila.ts` envio com as regras de ritmo; webhook
- `src/lib/crm/automacoes.ts` campanhas do dia
- `src/lib/crm/envio/` adaptadores (WA-AKG, Cloud API)
- `src/app/api/crm/*` rotas; `src/app/crm/*` telas; `src/components/crm/*`
