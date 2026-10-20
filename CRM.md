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

Na pasta do painel:

1. **`instalar-whatsapp.cmd`** (uma vez, botão direito → Executar como
   administrador). Instala o MariaDB em silêncio, baixa a WA-AKG para a
   pasta `WA-AKG` ao lado do painel, cria o `.env` (porta 3200, fuso de
   São Paulo), monta o banco, compila e pede um e-mail e senha para o seu
   usuário. Leva uns 10 minutos.
2. **Ligar**: não precisa de nada. O `iniciar-painel.cmd` liga a WA-AKG junto
   em <http://localhost:3200> e a mantém no ar (se cair, volta sozinha), tudo
   numa janela só. O que ela escreve vai para `dados\whatsapp.log`. O
   `iniciar-whatsapp.cmd` continua existindo para subir só ela; se ela já
   estiver rodando, ele não abre outra, e o painel também não (duas cópias
   conectariam os mesmos números e uma derrubaria a outra).

Depois, em <http://localhost:3200>:

1. **Sessions** → criar uma sessão por loja (nome curto, ex.: `centro`,
   `fiusa`) e escanear o QR no celular da loja em *Dispositivos conectados*.
   Comece com uma loja só.
2. **API Key**: no seu usuário, copie a chave.
3. **Webhooks**: não precisa cadastrar. O painel cria e confere sozinho o
   webhook de cada número (veja "Webhook de cada número" abaixo).

No painel, CRM → Configurar → Envio: provedor WA-AKG, endereço
`http://localhost:3200`, API Key. Em Números, cole o nome da sessão de cada
loja, ligue e teste ("situação" e "mandar teste" para o seu celular).

### Atualizar a WA-AKG

Dois cliques em **`atualizar-whatsapp.cmd`** (ou `atualizar-whatsapp.cmd v1.7.1`
para outra versão). Ele monta a versão nova em `WA-AKG-novo` enquanto a atual
continua no ar, guarda o banco em `WA-AKG-banco-<data>.sql`, e só então troca;
a anterior fica em `WA-AKG-anterior-<data>`. O WhatsApp fica fora por segundos.

Desde a 1.7 a WA-AKG só manda webhook para endereço **https público** (recusa
localhost). Por isso o painel cadastra o webhook com o endereço público
(CRM → Configurar → Envio → "Endereço público do painel", padrão
`https://painel.viasolbrazil.com.br`): a mensagem sai para o Cloudflare e volta
pelo túnel. Antes de trocar, o painel testa se esse endereço chega mesmo nele;
se não chegar (ex.: um Cloudflare Access na frente do painel), continua no
localhost e avisa no "situação". Não ponha Access no `painel.`; ele já tem login.

Voltar para a anterior: pare o painel, renomeie as pastas de volta e restaure o
banco com o `.sql`. Sem restaurar o banco a versão antiga não lê as sessões
(a 1.7 grava as chaves criptografadas), e as lojas podem precisar parear de novo.

### Acessar a WA-AKG de fora (whats.viasolbrazil.com.br)

1. Cloudflare → Networking → Tunnels → `painel` (o mesmo túnel, não precisa
   de outro) → **Add route** → *Published application*: subdomínio `whats`,
   domínio `viasolbrazil.com.br`, serviço `http://localhost:3200`.
2. **Proteja antes de usar**: Zero Trust → Access → Applications → Add →
   Self-hosted, domínio `whats.viasolbrazil.com.br`, política *Allow* com o
   seu e-mail. Só entra quem recebe o código no e-mail. Isso importa porque a
   WA-AKG até a 1.6 vem com o cadastro de usuários aberto e a senha da tela
   /swagger visível no código da página (a 1.7 corrigiu as duas); quem
   chegasse nela controlaria o WhatsApp de todas as lojas.
3. Na WA-AKG → Settings, desligue **Enable User Registration**.
4. No `WA-AKG\.env`, **não** deixe `NEXTAUTH_URL` (sem ele a WA-AKG usa o
   endereço por onde a pessoa entrou; com `localhost`, o login pelo link
   manda para o localhost) e ponha `BASE_URL="https://whats.viasolbrazil.com.br"`
   (libera o chat ao vivo pelo link). Depois, CRM → Configurar → Envio →
   **Reiniciar WhatsApp**.

Não troque o `BASE_URL` do `WA-AKG\.env`: até a 1.6 a WA-AKG manda esse
endereço a cada 30 segundos para o servidor de monitoramento do autor dela (o
atualizador põe `ENABLE_TELEMETRY="false"`, que desliga isso na 1.7). Deixando
`localhost`, o link público não vaza. O login funciona pelo link mesmo assim
(ela aceita o endereço de quem acessa). O painel continua falando com ela por
`http://localhost:3200`, então nada muda no CRM.

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

A aba **Análise** mostra: clientes ativas e gasto médio no ano, recompra,
onde está o dinheiro (cada faixa: % das clientes contra % da receita), em
quantos dias a cliente volta comparado com a validade do cashback, o que
aconteceu com o cashback creditado, receita e cobertura de celular por
loja, tempo de resposta por loja, % de celular por vendedora e o resultado
das mensagens.

A aba **Clientes** abre com as faixas (Ouro, Prata, Bronze, Nova, Parada,
Sem compra) como filtro, mais loja, situação, busca e ordem. "Criar campanha
com essas" leva os filtros pra uma campanha nova.

O tempo de resposta conta toda conversa, inclusive quando a cliente chama
primeiro. "Obrigada", "ok", emoji e figurinha não abrem espera; mensagem
automática do WhatsApp Business (o mesmo texto mandado pra 5+ conversas)
não conta como resposta; vale a hora em que a mensagem foi mandada.

## Atendimento (aba no topo) e webhook

A aba **Atendimento**, no menu principal, mostra o WhatsApp de cada loja
ligada: quem está esperando resposta, tempo de resposta, clientes do dia e
vendas pelo WhatsApp no mês. A Visão geral do CRM fica com envio, celular no
caixa por loja e conferência do cashback.

Na WA-AKG o webhook é **por sessão**: sessão nova (ou pareada de novo) nasce
sem webhook, e apagar uma sessão apaga o webhook dela. O painel confere e
cria o webhook de cada número ligado sozinho (ao subir, a cada 10 minutos,
ao salvar Números e no botão "situação", que mostra "webhook ok").

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
automáticas nos últimos 30 dias. Quatro ideias prontas (boas clientes
sumidas, cashback esquecido, segunda compra, lançamento) já trazem público e
texto pra ajustar. "Fila de envio" mostra o que o sistema tem pra mandar,
o que deu erro e o que ficou simulado; as conversas em si ficam na WA-AKG.

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

## Painel da loja

`/crm/loja?k=CODIGO_DA_TV&loja=Centro`, pra gerente e vendedoras (o código
é o mesmo da tela de metas). Venda e desconto continuam no PDV. Mostra as
vendas do mês contra a meta (e o ranking das lojas na meta), cada vendedora
(vendido, ticket, % com celular), os produtos que mais saíram em 30 dias,
quem está esperando resposta no WhatsApp (com botão pra abrir a
conversa), conversas do dia, tempo de resposta, % das vendas de 30 dias com
celular semana a semana, o ranking das lojas nas duas coisas e o % de cada
vendedora. Atualiza sozinho a cada minuto.

Cashback é manual: a cliente mostra a mensagem, a vendedora toca em
"Cliente veio usar o cashback", digita o celular, confere o saldo, dá o
desconto no PDV e dá baixa ali. A baixa é o que impede usar o mesmo
cashback duas vezes (ou em outra loja) e para os lembretes de vencimento.

**Conferência** (Visão geral, e na tela da loja): a sincronização diária
traz o desconto de cada nota. Venda com desconto pra cliente que tinha
saldo, sem baixa até uma semana depois, aparece como "desconto sem baixa";
baixa sem nenhuma nota com desconto da cliente aparece como "baixa sem
desconto". Desconto com código de aniversário ou campanha não entra.

**Horário de atendimento** de cada loja em Configurar → Números (ex.:
10:00-22:00, domingo 14:00-20:00, vazio = fechado). O tempo de resposta só
conta dentro dele.

**Aviso de SAIR**: a primeira mensagem que cada cliente recebe termina com
"Se preferir não receber mensagens nossas por aqui, é só responder SAIR"
(Configurar → Envio, dá pra mudar o texto ou desligar).

Cashback de compra no site só gera mensagem pra quem mora numa cidade com
loja, lembrando o endereço (preencha em Configurar → Números). Quem mora
longe não recebe.

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
