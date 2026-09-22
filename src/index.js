const encoder = new TextEncoder();
const GOLS_API = "https://golsfla.duckdns.org";

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
    const ok = await crypto.subtle.verify({ name: "Ed25519" }, key, signatureBytes, encoder.encode(timestamp + body));
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

function optionValue(interaction, name) {
  return interaction.data?.options?.find((o) => o.name === name)?.value;
}

async function searchGoals(query, limit = 25) {
  const response = await fetch(`${GOLS_API}/api/gols?q=${encodeURIComponent(query)}&limit=${limit}`);
  if (!response.ok) throw new Error(`Busca HTTP ${response.status}`);
  return response.json();
}

const CHANNEL_BUTTON = {
  type: 1,
  components: [{
    type: 2,
    style: 5,
    label: "📢 Canal do Flamengo",
    url: "https://t.me/Flamengo77",
  }],
};

function goalCaption(goal) {
  return [
    `**${goal.jogo}**`,
    "",
    `⚽️ ${goal.autor || "-"}`,
    `🅰️ ${goal.assistencia || "-"}`,
    "",
    `🏆 ${goal.campeonato || "-"} - ${goal.fase || "-"}`,
  ].join("\n");
}

function startMessage() {
  return {
    content: [
      "🔴⚫ **Bem-vindo ao Gols Flamengo!**",
      "",
      "Aqui você pode buscar e assistir aos gols do Flamengo diretamente no Discord.",
      "",
      "🔎 Use **/gol** para pesquisar no nosso acervo.",
      "❓ Se precisar de ajuda, use **/help**.",
    ].join("\n"),
    components: [CHANNEL_BUTTON],
  };
}

function helpMessage() {
  return {
    content: [
      "📖 **Como usar o Gols Flamengo**",
      "",
      "⚽ **/gol** — Pesquise um gol do nosso acervo.",
      "",
      "Você pode buscar por:",
      "👤 Jogador — `Pedro`",
      "🆚 Jogo/adversário — `Flamengo x Vasco`",
      "🏆 Campeonato — `Libertadores`",
      "📅 Fase/rodada — `28ª rodada`",
      "",
      "Conforme você digita, os resultados aparecem automaticamente. Escolha o gol desejado e o bot enviará o vídeo no canal.",
    ].join("\n"),
    components: [CHANNEL_BUTTON],
  };
}

async function sendGoal(interaction, env, ctx) {
  const goalId = String(optionValue(interaction, "busca") || "").trim();
  if (!goalId) return json({ type: 4, data: { content: "❌ Escolha um gol na busca.", flags: 64 } });

  ctx.waitUntil((async () => {
    try {
      const metaResponse = await fetch(`${GOLS_API}/api/gols?q=${encodeURIComponent(goalId)}&limit=25`);
      if (!metaResponse.ok) throw new Error(`Busca HTTP ${metaResponse.status}`);
      const meta = await metaResponse.json();
      let goal = meta.results?.find((item) => String(item.id) === goalId);

      // O autocomplete entrega o ID. Se a busca por ID não encontrar porque o endpoint
      // pesquisa apenas metadados, usamos uma pequena busca pelo catálogo recente via ID URL
      // e enviamos o vídeo; normalmente o autocomplete já contém os metadados no nome.
      if (!goal) {
        goal = { id: goalId, jogo: "Gol do Flamengo", autor: "-", assistencia: "-", campeonato: "-", fase: "-" };
      }

      const source = await fetch(`${GOLS_API}/gol/${encodeURIComponent(goalId)}.mp4`);
      if (!source.ok) throw new Error(`Vídeo HTTP ${source.status}`);
      const bytes = await source.arrayBuffer();

      const form = new FormData();
      form.append("payload_json", JSON.stringify({ content: goalCaption(goal), components: [CHANNEL_BUTTON] }));
      form.append("files[0]", new Blob([bytes], { type: "video/mp4" }), `gol-${goalId}.mp4`);

      const sent = await fetch(`https://discord.com/api/v10/webhooks/${env.DISCORD_APPLICATION_ID}/${interaction.token}`, {
        method: "POST",
        body: form,
      });
      if (!sent.ok) throw new Error(`Discord HTTP ${sent.status}: ${await sent.text()}`);
    } catch (error) {
      await fetch(`https://discord.com/api/v10/webhooks/${env.DISCORD_APPLICATION_ID}/${interaction.token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: `❌ Falha ao enviar o gol: ${error.message}` }),
      });
    }
  })());

  return json({ type: 5 });
}

async function handleAutocomplete(interaction) {
  const focused = interaction.data?.options?.find((o) => o.focused);
  const query = String(focused?.value || "").trim();
  if (!query) return json({ type: 8, data: { choices: [] } });

  try {
    const data = await searchGoals(query, 25);
    const choices = (data.results || []).slice(0, 25).map((goal) => {
      const label = `${goal.autor || "Gol"} — ${goal.jogo} — ${goal.campeonato || ""}`;
      return { name: label.slice(0, 100), value: String(goal.id) };
    });
    return json({ type: 8, data: { choices } });
  } catch {
    return json({ type: 8, data: { choices: [] } });
  }
}

async function registerCommands(env) {
  const commands = [
    { name: "start", description: "Mensagem de boas-vindas do Gols Flamengo", type: 1 },
    { name: "help", description: "Mostra como usar o bot e pesquisar gols", type: 1 },
    { name: "ping", description: "Verifica se o bot está online", type: 1 },
    {
      name: "gol",
      description: "Busca e envia um gol do acervo do Flamengo",
      type: 1,
      options: [{
        name: "busca",
        description: "Digite jogador, jogo, campeonato ou fase",
        type: 3,
        required: true,
        autocomplete: true,
      }],
    },
  ];
  const response = await fetch(`https://discord.com/api/v10/applications/${env.DISCORD_APPLICATION_ID}/commands`, {
    method: "PUT",
    headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(commands),
  });
  const body = await response.text();
  return response.ok
    ? json({ ok: true, message: "Slash commands registered." })
    : json({ ok: false, status: response.status, error: body }, 502);
}

async function handleInteraction(request, env, ctx) {
  const verified = await verifyDiscordRequest(request, env.DISCORD_PUBLIC_KEY);
  if (!verified.ok) return new Response("invalid request signature", { status: 401 });

  let interaction;
  try { interaction = JSON.parse(verified.body); }
  catch { return new Response("invalid json", { status: 400 }); }

  if (interaction.type === 1) return json({ type: 1 });
  if (interaction.type === 4) return handleAutocomplete(interaction);

  if (interaction.type === 2) {
    const command = interaction.data?.name;
    if (command === "start") return json({ type: 4, data: startMessage() });
    if (command === "help") return json({ type: 4, data: helpMessage() });
    if (command === "ping") return json({ type: 4, data: { content: "🏓 Pong! Bot online no Cloudflare Workers." } });
    if (command === "gol") return sendGoal(interaction, env, ctx);
    return json({ type: 4, data: { content: "Comando ainda não implementado.", flags: 64 } });
  }

  return json({ type: 4, data: { content: "Interação recebida.", flags: 64 } });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/") {
      return json({ ok: true, service: "discord-bot-worker", interactions: "/interactions" });
    }
    if (request.method === "POST" && url.pathname === "/interactions") return handleInteraction(request, env, ctx);
    if (request.method === "POST" && url.pathname === "/admin/register-commands") return registerCommands(env);

    if (request.method === "GET" && url.pathname === "/admin/commands") {
      const response = await fetch(`https://discord.com/api/v10/applications/${env.DISCORD_APPLICATION_ID}/commands`, {
        headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}` },
      });
      const body = await response.text();
      return new Response(body, {
        status: response.status,
        headers: { "content-type": "application/json; charset=UTF-8" },
      });
    }

    return new Response("Not Found", { status: 404 });
  },
};
