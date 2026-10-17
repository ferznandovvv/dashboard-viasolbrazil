# Rodar o dashboard numa máquina da empresa

Guia para tirar o sistema da Vercel e rodar num computador seu. O sistema
detecta sozinho que não está na Vercel e passa a guardar os dados na pasta
`dados/`, aqui do lado — nada de serviço externo.

## 1. Preparar a máquina

Qualquer computador que fique ligado serve. Precisa de:

- **Node.js 20 ou mais novo** — baixe em <https://nodejs.org> (versão LTS)
- **Git** — <https://git-scm.com>

## 2. Baixar e configurar

```bash
git clone https://github.com/ferznandovvv/dashboard-viasolbrazil.git
cd dashboard-viasolbrazil
npm install
```

### Configurar as chaves

As chaves das integrações não vêm da Vercel: as marcadas como sensíveis lá
nunca são devolvidas, nem para o dono. Elas são recolocadas pelo próprio
sistema, numa tela feita para isso.

Crie um arquivo `.env.local` só com a senha de acesso:

```
DASHBOARD_PASSWORD=sua-senha
```

Essa senha serve para o primeiro acesso: na tela de entrar, o sistema pede
para criar a conta do **Dono** (nome, usuário e senha) e confirma com ela.
Quem já tinha usuário no financeiro entra com o mesmo usuário e senha. As
outras pessoas e um usuário para cada loja se cadastram em
**Configurações › Pessoas e acessos**, e lá também se desliga a senha antiga.

Depois de subir o sistema (passo 3), abra **Configurações** no menu lateral.
Para cada integração:

- **TOTVS, Shopify e Meta** — cole as chaves e clique em Salvar.
- **TikTok Shop, Mercado Livre e TikTok Ads** — cole as chaves do app, salve
  e clique em **autorizar agora**. O token gerado é salvo sozinho.

Tudo vale na hora, sem reiniciar, e fica guardado em `dados/credenciais.json`
(fora do Git).

**Truque da autorização:** os apps estão cadastrados com o endereço da
Vercel. Depois de autorizar, o navegador vai para
`https://dashboard-viasolbrazil.vercel.app/?code=...` — mesmo que a página
apareça pausada ou com erro, troque só o começo do endereço por
`http://localhost:3100` (mantendo o `/?code=...` do resto) e aperte Enter.

## 3. Subir

Dê dois cliques em **`iniciar-painel.cmd`**, na pasta do projeto. Ele busca
atualizações, prepara o sistema e sobe em <http://localhost:3100> — a porta
3100 para não brigar com outros programas que usam a 3000 (Remotion etc.).
Não feche a janela.

## 4. Ligar junto com o Windows

1. `Win + R` → digite `shell:startup` → Enter (abre a pasta Inicializar)
2. Clique com o botão direito em `iniciar-painel.cmd` → **Mostrar mais opções →
   Criar atalho**, e arraste o atalho para essa pasta

Toda vez que o computador ligar, o painel sobe sozinho — já atualizado.

## 5. Atualizar os dados todo dia

Não precisa configurar nada: rodando na máquina, o próprio sistema aquece o
cache às 6h40 (vendas, venda por produto e estoque), continua o estoque às
6h58, e também um minuto depois de ligar.

## 6. Acessar de fora da loja

Um túnel do Cloudflare (gratuito) publica o painel em
`https://painel.viasolbrazil.com.br`. O conector `cloudflared` fica instalado
como serviço do Windows, então volta sozinho. No Zero Trust → Networks →
Tunnels → painel, a rota deve apontar para `127.0.0.1:3100`.

## Atualizar o sistema depois

Sozinho. Aberto pelo `iniciar-painel.cmd`, o painel confere o GitHub a cada 5
minutos; quando há versão nova, baixa, monta ao lado (`.next-a` / `.next-b`)
enquanto a atual continua no ar e troca em poucos segundos. Se a versão nova
não montar, a anterior segue rodando. O histórico fica em `dados/painel.log`,
e a tela de configuração mostra quando foi a última atualização.

## Se algo não funcionar

- **Não consigo entrar** — use o seu usuário e senha (os mesmos do financeiro).
  Sem usuário, deixe o campo em branco e use a senha do `DASHBOARD_PASSWORD`
  (entra como Sócia, e só enquanto ela não for desligada em Pessoas e acessos)
- **Lojas físicas vazias** — confira as quatro variáveis `TOTVS_`
- **Estoque demorando** — feche e abra o painel de novo: um minuto depois
  de ligar ele monta a foto completa
- **Medir desempenho** — abra `/api/perf`

## CRM das lojas

A aba **CRM** (clientes, cashback e WhatsApp) também guarda tudo em
`dados/crm/`. O passo a passo de configuração, incluindo a WA-AKG na mesma
máquina, está em [CRM.md](CRM.md).
