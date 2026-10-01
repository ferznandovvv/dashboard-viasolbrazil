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

### Trazer as variáveis da Vercel automaticamente

Em vez de copiar uma a uma, deixe a CLI da Vercel baixar tudo:

```bash
npm install -g vercel
vercel login
vercel link          # escolha a conta e o projeto dashboard-viasolbrazil
vercel env pull .env.local --environment=production
```

Isso cria o `.env.local` já preenchido.

**Depois, abra o `.env.local` e apague a linha `BLOB_READ_WRITE_TOKEN=...`.**
É a ausência dela que faz o sistema guardar os dados na pasta local em vez de
tentar falar com a Vercel.

Se preferir fazer à mão, use `.env.local.exemplo` como modelo e copie os
valores de Settings → Environment Variables (ícone de olho para revelar).

## 3. Subir

```bash
npm run build
npm start
```

O sistema fica em <http://localhost:3000>. Para abrir de outro computador da
mesma rede, use o IP da máquina (ex.: `http://192.168.0.50:3000`).

## 4. Deixar rodando sozinho

**Windows** — instale o gerenciador de processos e registre como serviço:

```bash
npm install -g pm2
pm2 start npm --name viasol -- start
pm2 save
pm2 startup
```

Assim ele volta sozinho quando a máquina reinicia.

## 5. Atualizar os dados todo dia

Na Vercel isso era o cron. Aqui, agende uma chamada diária à rota de
aquecimento — é ela que deixa estoque e vendas prontos antes de alguém abrir.

**Windows (Agendador de Tarefas):** crie uma tarefa diária às 6h40 que execute

```
curl http://localhost:3000/api/aquecer
```

**Linux (crontab -e):**

```
40 6 * * * curl -s http://localhost:3000/api/aquecer > /dev/null
```

## 6. Acessar de fora da loja (opcional)

Para abrir do celular em qualquer lugar, sem liberar porta no roteador, use
um túnel do Cloudflare — é gratuito e dá um endereço HTTPS fixo:

```bash
npm install -g cloudflared
cloudflared tunnel --url http://localhost:3000
```

Ele imprime um endereço `https://algo.trycloudflare.com`. Para um endereço
fixo e permanente, crie uma conta gratuita no Cloudflare e siga
<https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/>.

## Atualizar o sistema depois

```bash
git pull
npm install
npm run build
pm2 restart viasol
```

## Se algo não funcionar

- **Página pede senha e não aceita** — confira `DASHBOARD_PASSWORD` no `.env.local`
- **Lojas físicas vazias** — confira as quatro variáveis `TOTVS_`
- **Estoque demorando** — rode `curl http://localhost:3000/api/aquecer` uma vez
  e aguarde; ele monta a foto completa
- **Medir desempenho** — abra `/api/perf`
