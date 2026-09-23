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

async function searchGoals(query, limit = 25, offset = 0) {
  const response = await fetch(`${GOLS_API}/api/gols?q=${encodeURIComponent(query)}&limit=${limit}&offset=${offset}`);
  if (!response.ok) throw new Error(`Busca HTTP ${response.status}`);
  return response.json();
}

async function goalsPage(page = 0) {
  const safePage = Math.max(Number(page) || 0, 0);
  return searchGoals("", 25, safePage * 25);
}

function goalsCatalogMessage(data, page) {
  const goals = data.results || [];
  if (!goals.length) {
    return { content: "⚽ Nenhum gol encontrado nesta página.", components: [] };
  }

  const options = goals.map((goal) => ({
    label: `${goal.autor || "Gol"} — ${goal.jogo}`.slice(0, 100),
    description: `${goal.campeonato || "-"} — ${goal.fase || "-"}`.slice(0, 100),
    value: String(goal.id),
  }));

  const nav = [];
  if (page > 0) nav.push({ type: 2, style: 2, label: "⬅️ Anterior", custom_id: `gols_page:${page - 1}` });
  if (goals.length === 25) nav.push({ type: 2, style: 2, label: "Próxima ➡️", custom_id: `gols_page:${page + 1}` });

  const components = [{
    type: 1,
    components: [{
      type: 3,
      custom_id: "gols_select",
      placeholder: "Escolha um gol para assistir",
      min_values: 1,
      max_values: 1,
      options,
    }],
  }];

  if (nav.length) components.push({ type: 1, components: nav });

  return {
    content: `📚 **Acervo de Gols do Flamengo**\n\nPágina **${page + 1}** — escolha um gol abaixo:`,
    components,
  };
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

async function ensureUsageTable(env) {
  await env.DB.prepare(
    "CREATE TABLE IF NOT EXISTS discord_uso (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT, guild_id TEXT, install_type TEXT NOT NULL, command TEXT NOT NULL, usado_em INTEGER NOT NULL)"
  ).run();
}

async function trackUsage(interaction, env, command) {
  await ensureUsageTable(env);
  const userId = interaction.member?.user?.id || interaction.user?.id;
  const guildId = interaction.guild_id;
  await env.DB.prepare(
    "INSERT INTO discord_uso (user_id, guild_id, install_type, command, usado_em) VALUES (?, ?, ?, ?, ?)"
  ).bind(
    userId ? String(userId) : null,
    guildId ? String(guildId) : null,
    guildId ? "guild" : "user",
    String(command || "unknown"),
    Date.now()
  ).run();
}

async function registerStart(interaction, env) {
  const userId = interaction.member?.user?.id || interaction.user?.id;
  const guildId = interaction.guild_id;
  const now = Date.now();

  if (userId) {
    await env.DB.prepare(
      "INSERT OR IGNORE INTO discord_usuarios (user_id, iniciado_em) VALUES (?, ?)"
    ).bind(String(userId), now).run();
  }

  if (guildId) {
    await env.DB.prepare(
      "INSERT OR IGNORE INTO discord_servidores (guild_id, registrado_em) VALUES (?, ?)"
    ).bind(String(guildId), now).run();
  }
}

async function statsMessage(env) {
  await ensureUsageTable(env);
  const since7d = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const [users, guilds, privateUsers, active7d, commands7d] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) AS total FROM discord_usuarios").first(),
    env.DB.prepare("SELECT COUNT(*) AS total FROM discord_servidores").first(),
    env.DB.prepare("SELECT COUNT(DISTINCT user_id) AS total FROM discord_uso WHERE install_type = 'user'").first(),
    env.DB.prepare("SELECT COUNT(DISTINCT user_id) AS total FROM discord_uso WHERE usado_em >= ?").bind(since7d).first(),
    env.DB.prepare("SELECT COUNT(*) AS total FROM discord_uso WHERE usado_em >= ?").bind(since7d).first(),
  ]);

  return {
    content: [
      "📊 **Estatísticas — Gols Flamengo**",
      "",
      `👥 Usuários únicos que usaram **/start**: **${users?.total || 0}**`,
      `👤 Usuários que usaram comandos no privado: **${privateUsers?.total || 0}**`,
      `🏠 Servidores únicos registrados via **/start**: **${guilds?.total || 0}**`,
      "",
      "📈 **Últimos 7 dias**",
      `🔥 Usuários ativos: **${active7d?.total || 0}**`,
      `⚡ Comandos utilizados: **${commands7d?.total || 0}**`,
      "",
      "ℹ️ O Discord não informa ao bot quais instalações vieram especificamente do **Descobrir**; o crescimento após a ativação pode ser acompanhado por estes indicadores.",
    ].join("\n"),
  };
}

function helpMessage() {
  return {
    content: [
      "📖 **GUIA COMPLETO — Gols Flamengo**",
      "",
      "O **Gols Flamengo** permite pesquisar, navegar e assistir aos gols do Flamengo diretamente no Discord.",
      "",
      "⚡ **/gol — Busca rápida**",
      "Use quando você já tem uma ideia do gol que procura.",
      "Ao tocar no campo **busca**, os gols mais recentes aparecem automaticamente. Você também pode digitar para filtrar o acervo.",
      "",
      "🔎 **Você pode pesquisar por:**",
      "👤 Jogador — exemplo: `Pedro`",
      "🆚 Jogo ou adversário — exemplo: `Flamengo x Vasco`",
      "🏆 Campeonato — exemplo: `Libertadores`",
      "📅 Fase ou rodada — exemplo: `28ª rodada`",
      "",
      "O Discord mostra até **25 sugestões por vez**. A pesquisa considera o acervo e exibe os resultados correspondentes mais recentes.",
      "",
      "📚 **/gols — Acervo completo**",
      "Use para explorar os gols cadastrados sem depender da busca rápida.",
      "São exibidos até **25 gols por página**. Use **⬅️ Anterior** e **Próxima ➡️** para navegar pelas páginas e escolha um gol no menu para assistir ao vídeo.",
      "",
      "👋 **/start — Início**",
      "Mostra a mensagem de boas-vindas e registra de forma única o usuário e o servidor nas estatísticas.",
      "",
      "📊 **/stats — Estatísticas**",
      "Mostra quantos usuários já iniciaram o bot e em quantos servidores ele foi registrado.",
      "",
      "🏓 **/ping — Status**",
      "Confirma se o bot está online e respondendo.",
      "",
      "💡 **Dica:** para encontrar um gol antigo rapidamente, tente pesquisar pelo jogador, adversário ou competição. Para passear por todo o acervo, use **/gols**.",
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
  try {
    // Campo vazio: mostra os gols mais recentes/disponíveis.
    // Ao digitar, mantém a busca normal por jogador, jogo, campeonato ou fase.
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
    { name: "start", description: "Mensagem de boas-vindas do Gols Flamengo", type: 1, integration_types: [0, 1], contexts: [0, 1, 2] },
    { name: "help", description: "Mostra como usar o bot e pesquisar gols", type: 1, integration_types: [0, 1], contexts: [0, 1, 2] },
    { name: "stats", description: "Mostra as estatísticas do Gols Flamengo", type: 1, integration_types: [0, 1], contexts: [0, 1, 2] },
    { name: "gols", description: "Navegue pelo acervo completo de gols", type: 1, integration_types: [0, 1], contexts: [0, 1, 2] },
    { name: "ping", description: "Verifica se o bot está online", type: 1, integration_types: [0, 1], contexts: [0, 1, 2] },
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
      integration_types: [0, 1],
      contexts: [0, 1, 2],
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
    ctx.waitUntil(trackUsage(interaction, env, command).catch((error) => console.error("D1 usage stats:", error)));
    if (command === "start") {
      try { await registerStart(interaction, env); } catch (error) { console.error("D1 start stats:", error); }
      return json({ type: 4, data: startMessage() });
    }
    if (command === "help") return json({ type: 4, data: helpMessage() });
    if (command === "stats") {
      try {
        return json({ type: 4, data: await statsMessage(env) });
      } catch (error) {
        console.error("D1 stats:", error);
        return json({ type: 4, data: { content: "❌ Não foi possível consultar as estatísticas agora.", flags: 64 } });
      }
    }
    if (command === "gols") {
      try {
        const data = await goalsPage(0);
        return json({ type: 4, data: goalsCatalogMessage(data, 0) });
      } catch (error) {
        console.error("Gols catalog:", error);
        return json({ type: 4, data: { content: "❌ Não foi possível abrir o acervo agora.", flags: 64 } });
      }
    }
    if (command === "ping") return json({ type: 4, data: { content: "🏓 Pong! Bot online no Cloudflare Workers." } });
    if (command === "gol") return sendGoal(interaction, env, ctx);
    return json({ type: 4, data: { content: "Comando ainda não implementado.", flags: 64 } });
  }

  if (interaction.type === 3) {
    const customId = interaction.data?.custom_id || "";

    if (customId.startsWith("gols_page:")) {
      const page = Math.max(Number(customId.split(":")[1]) || 0, 0);
      try {
        const data = await goalsPage(page);
        return json({ type: 7, data: goalsCatalogMessage(data, page) });
      } catch (error) {
        console.error("Gols pagination:", error);
        return json({ type: 4, data: { content: "❌ Não foi possível carregar esta página.", flags: 64 } });
      }
    }

    if (customId === "gols_select") {
      const goalId = String(interaction.data?.values?.[0] || "");
      interaction.data = { name: "gol", options: [{ name: "busca", value: goalId }] };
      return sendGoal(interaction, env, ctx);
    }
  }

  return json({ type: 4, data: { content: "Interação recebida.", flags: 64 } });
}

function legalPage(title, content) {
  const html = `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${title} — Gols Flamengo</title>
  <style>
    *{box-sizing:border-box}body{margin:0;background:#0f1115;color:#f5f5f5;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;line-height:1.65}
    main{max-width:760px;margin:0 auto;padding:48px 22px 70px}.brand{font-weight:800;font-size:1.1rem;color:#ff3b3b;margin-bottom:28px}
    h1{font-size:2rem;line-height:1.2;margin:0 0 8px}h2{font-size:1.15rem;margin-top:30px;color:#fff}
    .updated{color:#9da3ae;margin-bottom:32px}.card{background:#171a21;border:1px solid #292e38;border-radius:16px;padding:24px}
    p{margin:10px 0;color:#d7d9de}a{color:#ff5a5a}footer{margin-top:32px;color:#8d929c;font-size:.9rem}
  </style>
</head>
<body><main><div class="brand">🔴⚫ Gols Flamengo</div><h1>${title}</h1><div class="updated">Última atualização: 23 de setembro de 2026</div><div class="card">${content}</div><footer>Gols Flamengo — aplicativo independente para consulta e reprodução de um acervo de gols no Discord.</footer></main></body>
</html>`;
  return new Response(html, { headers: { "content-type": "text/html; charset=UTF-8", "cache-control": "public, max-age=3600" } });
}

function termsPage() {
  return legalPage("Termos de Serviço", `
    <h2>1. Sobre o serviço</h2>
    <p>O Gols Flamengo é um aplicativo para Discord que permite pesquisar, navegar e reproduzir conteúdos do seu acervo de gols do Flamengo.</p>
    <h2>2. Uso do aplicativo</h2>
    <p>Ao utilizar o aplicativo, você concorda em usá-lo de forma legítima e de acordo com as regras do Discord. É proibido tentar explorar falhas, prejudicar o funcionamento do serviço, automatizar abusivamente requisições ou utilizar o aplicativo para atividades ilícitas.</p>
    <h2>3. Disponibilidade</h2>
    <p>O serviço é oferecido conforme disponível. Recursos, comandos e conteúdos podem ser alterados, suspensos ou removidos quando necessário, inclusive para manutenção ou adequações técnicas.</p>
    <h2>4. Conteúdo e direitos</h2>
    <p>Marcas, nomes, imagens, vídeos e demais conteúdos de terceiros permanecem sujeitos aos direitos de seus respectivos titulares. O Gols Flamengo não declara propriedade sobre marcas ou conteúdos pertencentes a terceiros.</p>
    <h2>5. Relação com terceiros</h2>
    <p>O Gols Flamengo é um projeto independente e não representa nem declara vínculo oficial com o Clube de Regatas do Flamengo ou com o Discord.</p>
    <h2>6. Alterações destes termos</h2>
    <p>Estes termos podem ser atualizados para refletir mudanças no aplicativo, em seus recursos ou em requisitos aplicáveis. A versão publicada nesta página será a versão vigente.</p>
  `);
}

function privacyPage() {
  return legalPage("Política de Privacidade", `
    <h2>1. Dados utilizados</h2>
    <p>Quando o comando /start é utilizado, o aplicativo pode registrar o identificador do usuário do Discord e, quando aplicável, o identificador do servidor. Esses identificadores são usados para contabilizar de forma única usuários e servidores nas estatísticas do serviço.</p>
    <h2>2. Finalidade</h2>
    <p>Os dados registrados são utilizados para funcionamento, manutenção, segurança e estatísticas do Gols Flamengo. O aplicativo não exige nome real, endereço, telefone ou dados de pagamento para utilizar seus comandos.</p>
    <h2>3. Compartilhamento</h2>
    <p>O Gols Flamengo não vende os identificadores registrados. O funcionamento do aplicativo depende de provedores de infraestrutura e do próprio Discord, que podem processar informações conforme suas próprias políticas.</p>
    <h2>4. Retenção e segurança</h2>
    <p>Os dados necessários às estatísticas podem ser mantidos enquanto o serviço estiver em operação. Medidas técnicas razoáveis são utilizadas para proteger a infraestrutura e limitar o acesso aos dados.</p>
    <h2>5. Alterações</h2>
    <p>Esta política pode ser atualizada quando houver mudanças no funcionamento do aplicativo ou no tratamento de dados. A versão publicada nesta página será a versão vigente.</p>
  `);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/terms") return termsPage();
    if (request.method === "GET" && url.pathname === "/privacy") return privacyPage();
    if (request.method === "GET" && url.pathname === "/") {
      return json({ ok: true, service: "discord-bot-worker", interactions: "/interactions" });
    }
    if (request.method === "POST" && url.pathname === "/interactions") return handleInteraction(request, env, ctx);
    return new Response("Not Found", { status: 404 });
  },
};
