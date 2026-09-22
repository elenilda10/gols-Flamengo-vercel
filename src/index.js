const encoder = new TextEncoder();

function hexToBytes(hex) {
  if (!hex || hex.length % 2 !== 0) return null;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    const value = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(value)) return null;
    bytes[i] = value;
  }
  return bytes;
}

async function verifyDiscordRequest(request, publicKey) {
  const signature = request.headers.get("X-Signature-Ed25519");
  const timestamp = request.headers.get("X-Signature-Timestamp");
  if (!signature || !timestamp || !publicKey) return { ok: false };

  const body = await request.text();
  const signatureBytes = hexToBytes(signature);
  const publicKeyBytes = hexToBytes(publicKey);
  if (!signatureBytes || !publicKeyBytes) return { ok: false };

  try {
    const key = await crypto.subtle.importKey("raw", publicKeyBytes, { name: "Ed25519" }, false, ["verify"]);
    const ok = await crypto.subtle.verify(
      { name: "Ed25519" },
      key,
      signatureBytes,
      encoder.encode(timestamp + body),
    );
    return { ok, body };
  } catch {
    return { ok: false };
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=UTF-8" },
  });
}

async function handleInteraction(request, env) {
  const verified = await verifyDiscordRequest(request, env.DISCORD_PUBLIC_KEY);
  if (!verified.ok) return new Response("invalid request signature", { status: 401 });

  let interaction;
  try {
    interaction = JSON.parse(verified.body);
  } catch {
    return new Response("invalid json", { status: 400 });
  }

  if (interaction.type === 1) return json({ type: 1 });

  if (interaction.type === 2) {
    const command = interaction.data?.name;

    if (command === "ping") {
      return json({ type: 4, data: { content: "🏓 Pong! Bot online no Cloudflare Workers." } });
    }

    if (command === "ajuda") {
      return json({
        type: 4,
        data: { content: "🤖 Bot Discord ativo. Use /ping para testar a conexão.", flags: 64 },
      });
    }

    return json({ type: 4, data: { content: "Comando ainda não implementado.", flags: 64 } });
  }

  return json({ type: 4, data: { content: "Interação recebida.", flags: 64 } });
}

async function registerCommands(env) {
  if (!env.DISCORD_APPLICATION_ID || !env.DISCORD_BOT_TOKEN) {
    return json({ ok: false, error: "Discord credentials are not configured." }, 500);
  }

  const commands = [
    { name: "ping", description: "Verifica se o bot está online", type: 1 },
    { name: "ajuda", description: "Mostra os comandos disponíveis", type: 1 },
  ];

  const response = await fetch(
    `https://discord.com/api/v10/applications/${env.DISCORD_APPLICATION_ID}/commands`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(commands),
    },
  );

  const body = await response.text();
  if (!response.ok) {
    return json({ ok: false, status: response.status, error: body }, 502);
  }

  return json({ ok: true, message: "Slash commands registered." });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/") {
      return json({ ok: true, service: "discord-bot-worker", interactions: "/interactions" });
    }

    if (request.method === "POST" && url.pathname === "/interactions") {
      return handleInteraction(request, env);
    }

    // Temporary bootstrap route. Remove immediately after the first successful registration.
    if (request.method === "POST" && url.pathname === "/admin/register-commands") {
      return registerCommands(env);
    }

    return new Response("Not Found", { status: 404 });
  },
};
