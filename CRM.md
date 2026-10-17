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
2. **Conferir a API do TOTVS**: Configurar → Dados → "Diagnóstico da API do TOTVS"
   → Consultar. A nota traz `personCode` (confirmado). No cadastro, veja
   `expandAceito` e se `lida.telefone` veio preenchido: telefones e e-mails
   só vêm quando pedidos com `expand`. Se vier vazio para uma cliente que
   tem telefone no TOTVS, me mostre o resultado que eu ajusto `lerPessoa`
   em `src/lib/crm/totvs.ts`.

   Quem entra como cliente: só quem aparece numa nota de venda **e** está
   marcado como cliente no TOTVS (`isCustomer`). Fornecedor, funcionária,
   representante e transportadora ficam de fora, assim como cadastros
   genéricos tipo "CONSUMIDOR FINAL" (e qualquer código que apareça em mais
   de 15% das notas de uma carga).
3. **Carga histórica**: Configurar → Dados → card TOTVS → "carga histórica…". Um ano
   é um bom começo. Não gera cashback do passado, só preenche quem é cliente
   e quanto gastou. Leva alguns minutos; a tela mostra o andamento.
4. **Regras**: Configurar → Cashback. Percentual, validade, mínimo para
   resgatar e teto por compra.
5. **WhatsApp**: veja abaixo.

## WA-AKG na mesma máquina (Windows)

A WA-AKG (<https://github.com/mrifqidaffaaditya/WA-AKG>) é um gateway não
oficial em cima do Baileys. Funciona como o WhatsApp Web: o servidor vira um
dispositivo pareado do número da loja; o celular continua funcionando normal.
Ela também tem uma tela de conversas de todas as sessões, que é onde você
acompanha o atendimento das lojas.

Na pasta do painel há dois arquivos:

1. **`instalar-whatsapp.cmd`** (uma vez, botão direito → Executar como
   administrador). Instala o MariaDB em silêncio, baixa a WA-AKG para a
   pasta `WA-AKG` ao lado do painel, cria o `.env` (porta 3200, fuso de
   São Paulo), monta o banco, compila e pede um e-mail e senha para o seu
   usuário. Leva uns 10 minutos.
2. **`iniciar-whatsapp.cmd`**: sobe a WA-AKG em <http://localhost:3200> e a
   mantém no ar (se cair, volta sozinha). Ponha um atalho dele em
   `shell:startup`, igual ao do painel.

Depois, em <http://localhost:3200>:

1. **Sessions** → criar uma sessão por loja (nome curto, ex.: `centro`,
   `fiusa`) e escanear o QR no celular da loja em *Dispositivos conectados*.
   Comece com uma loja só.
2. **API Key**: no seu usuário, copie a chave.
3. **Webhooks**: cadastre `http://localhost:3100/api/crm/webhook?t=...` (a URL
   exata aparece em CRM → Configurar → Envio) com os eventos
   `message.received`, `message.sent` e `message.status`. É isso que alimenta
   o atendimento na Visão geral e marca as respostas das clientes.

No painel, CRM → Configurar → Envio: provedor WA-AKG, endereço
`http://localhost:3200`, API Key. Em Números, cole o nome da sessão de cada
loja, ligue e teste ("situação" e "mandar teste" para o seu celular).

Para acessar a tela de conversas de fora de casa, crie no túnel do Cloudflare
uma segunda rota (ex.: `whats.viasolbrazil.com.br` → `127.0.0.1:3200`) e
troque `BASE_URL`/`NEXTAUTH_URL` no `WA-AKG\.env` para esse endereço.

Comece com uma ou duas lojas e teto baixo. Se der problema de conexão
repetido, o adaptador da Cloud API (oficial) está pronto em
`src/lib/crm/envio/cloudApi.ts`: é trocar o provedor e colar o token e os
`phone_number_id`. Lembre que fora da janela de 24h a oficial só aceita
template aprovado, então as campanhas precisariam ser cadastradas na Meta.

## Modo sombra, limite de contato e códigos

O CRM nasce em **modo sombra**: as automações e campanhas rodam, mas as
mensagens ficam como **simuladas** e nada sai. Leia em Mensagens o que teria
saído, ajuste textos e regras, e desligue em Configurar → Envio quando
estiver confortável. Simulada nunca sai, nem depois de desligar o modo
sombra (senão o acúmulo de dias sairia de uma vez); "Limpar simuladas" em
Mensagens apaga o histórico do ensaio.

Loja física sem número de WhatsApp no CRM não manda nada: a mensagem dela
não sai pelo número de outra loja. Só cliente do site sem loja na cidade sai
pelo primeiro número ativo.

O teto por número é **50 por dia** (números antigos, com histórico de
conversa, aguentam). Conta só o que o sistema manda: cliente chamando e
vendedora respondendo pelo celular não entram na conta.

Cada cliente recebe no máximo **2 mensagens em 30 dias**, de qualquer
campanha (o aviso de cashback da própria compra não conta). Aniversário e
reativação mandam um **código único de 6 letras** amarrado à campanha; a
vendedora digita no caixa ("Cliente trouxe um código de oferta") e a aba
Análise mostra qual campanha trouxe cliente de verdade.

## Análise

A aba **Análise** calcula da base: % de clientes com celular e com
aniversário, % de vendas com cliente identificado (por loja e por
vendedora), taxa de recompra e em quantos dias ela acontece (pra calibrar a
validade do cashback), faixas RFM (Ouro, Prata, Bronze, Nova, Parada) com
receita de cada uma, resultado por campanha (resposta, SAIR, código usado,
compra em 14 dias) e o extrato geral do cashback.

## Visão geral (painel gerencial)

Um cartão por loja, ordenado do que precisa de atenção para o que está bem:

- **Semáforo**: vermelho se o WhatsApp caiu ou tem cliente esperando há mais
  de 1h; amarelo se tem alguém esperando, se a loja responde em mais de
  15 min (mediana de 7 dias) ou se menos da metade das vendas sai com
  celular. Tracejado: loja ainda sem número no CRM.
- **Atendimento**: conversas do dia, quem está esperando (mais de 15 min de
  expediente) e tempo de resposta. Conta resposta digitada no celular da
  loja e mandada pela API; só o horário de atendimento, sem domingo.
- **Celular no caixa**: % das vendas dos últimos 30 dias em que a cliente tem
  celular cadastrado, comparado com os 30 anteriores, e a evolução por
  semana. É o número a cobrar das gerentes (consumidor final conta como sem).

Clicar no cartão abre o detalhe: atendimento em 24h/7/30 dias, a lista de
quem está esperando e o % de celular por vendedora. A tela da loja
(`/crm/loja` → Minha loja) mostra o mesmo para a gerente, com o botão de
responder quem está esperando.

## Campanhas

Aba **Campanhas** → Nova campanha: escolha loja(s) e faixa (Ouro, Prata...),
filtros extras (sem comprar há X dias, gasto mínimo, com cashback,
aniversariantes), o máximo de clientes e o texto (até 3 versões, cada cliente
recebe uma sorteada). Oferta opcional gera um código único por cliente. A
prévia mostra quantas recebem, quem fica de fora e por quê (limite do mês,
sem telefone, loja sem número) e como a mensagem chega.

As mensagens saem espalhadas na duração escolhida (1h a 4h), cada número
com as suas, em intervalos irregulares. O que cair fora do horário de envio
ou passar do teto do dia fica para o próximo horário. Cada campanha mostra
entregues, lidas, respostas, SAIR, código usado e quem comprou em 14 dias;
"Parar campanha" cancela o que ainda não saiu. Embaixo, o resultado das
automáticas nos últimos 30 dias.

## Shopify (site)

Só entram pedidos **pagos, não cancelados, sem disputa e sem a análise de
risco da Shopify mandando cancelar** (a recomendação "investigar" não barra,
porque esses pedidos em geral são legítimos e entregues). Como fraude costuma
entrar como pago e virar estorno dias depois, a sincronização diária olha 45
dias para trás e remove da base o que deixou de valer, tirando o cashback
junto se ainda não foi usado.

Os pedidos entram como vendas da loja **Site**, usando o mesmo
token da Shopify já configurado no painel. A cliente é identificada pelo
telefone (do cadastro ou do endereço de entrega), com e-mail e id da Shopify
como apoio, então quem compra no site e na loja vira uma pessoa só.

Quem compra, na loja ou no site, já aceita contato no cadastro, então toda
cliente entra como "aceita mensagens"; só fica de fora quem pediu para sair
(respondeu SAIR, foi marcada na ficha, ou cancelou o SMS na Shopify) e quem
tem "funcionária", "colaboradora" ou "vendedora" no nome do cadastro. Enquanto o site estiver no Edrone, cliente que **só** comprou no
site não entra nas automações (aniversário, pós-venda, reativação); mensagem
avulsa para um segmento sempre funciona. Dá pra ligar em Configurar →
Cashback. Se a Shopify devolver telefone e e-mail como `null` no
diagnóstico, o app precisa da permissão `read_customers`.

Cashback de compra no site é opcional (Configurar → Cashback). Faz sentido
se a ideia é trazer a cliente do site para a loja.

## Caixa da loja

`/crm/loja?k=CODIGO` (o mesmo `TV_CODE` da tela de metas). No celular ou
tablet da loja, duas abas. **Caixa**: buscar a cliente por celular, CPF ou
nome; cadastrar na hora com o aceite de mensagens; ver saldo; registrar
resgate; dar baixa num código de oferta. **Minha loja**: o % de clientes da
loja com celular (e a posição no ranking das lojas), o informativo de por
que pedir o celular, e quem dá pra chamar esta semana (cashback vencendo e
aniversariantes do mês, com botão direto pro WhatsApp). O resgate aqui só
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
| Boas-vindas | desligada: a primeira mensagem já é a do cashback | aviso |
| Cashback creditado (loja) | até 3 dias depois do crédito | aviso |
| Cashback creditado (site) | idem; se a cidade de entrega tem loja, avisa qual | aviso |
| Cashback vencendo | primeiro aviso 10 dias antes, último com urgência 2 dias antes | aviso |
| Aniversário | no dia, com a oferta configurada (10% por padrão) | marketing |
| Pós-venda | desligada até ter um formato que não gere problema | aviso |
| Reativação | desligada até combinar com as gerentes; oferta por faixa de total gasto (R$ 500 → 10%, R$ 1.000 → presente) | marketing |

Regra do cashback combinada: **15%** da compra, válido por **90 dias**, e a
compra em que ela usa precisa ser **pelo menos 3 vezes** o valor usado (ou
seja, o cashback paga no máximo um terço). Compra no site também gera.

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
