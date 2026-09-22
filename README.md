# Discord Bot Worker

Bot oficial do Discord usando Discord Interactions via HTTP e Cloudflare Workers.

## Estrutura

- `src/index.js`: endpoint HTTP e validação Ed25519.
- `POST /interactions`: endpoint para configurar no Discord Developer Portal.
- `GET /`: health check.
- `scripts/register-commands.js`: registra os slash commands `/ping` e `/ajuda`.

## Secrets no Cloudflare

Configure a chave pública do aplicativo Discord:

```bash
npx wrangler secret put DISCORD_PUBLIC_KEY
```

O token do bot não é necessário para validar Interactions no Worker. Guarde-o como segredo e nunca faça commit.

## Deploy

```bash
npm install
npm run deploy
```

Depois use a URL publicada acrescida de `/interactions` como Interactions Endpoint URL no Discord Developer Portal.

## Registrar comandos

No seu computador, defina temporariamente `DISCORD_APPLICATION_ID` e `DISCORD_BOT_TOKEN` no ambiente e execute:

```bash
npm run register:commands
```

Nunca coloque o token real no repositório.
