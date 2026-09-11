import { sendMessage } from "./telegram.js";

async function getConfig(db, chave) {
  const row = await db.prepare("SELECT valor FROM config WHERE chave = ?").bind(chave).first();
  return row ? row.valor : null;
}

async function setConfig(db, chave, valor) {
  await db.prepare("INSERT OR REPLACE INTO config (chave, valor) VALUES (?, ?)")
    .bind(chave, String(valor))
    .run();
}

function escHTML(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function nomeUsuario(from) {
  const nome = `${from?.first_name || ""} ${from?.last_name || ""}`
    .replace(/[\u0000-\u001F\u007F-\u009F\uFFFD]/g, "")
    .trim();
  return nome || "Torcedor";
}

function parseVencedores(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function normalizarPlacar(valor) {
  const texto = String(valor || "").trim();
  const match = texto.match(/^(\d+)\s*[xX×:\-]\s*(\d+)$/);
  if (!match) return null;
  return `${Number(match[1])}x${Number(match[2])}`;
}

export function extrairPostagemIdResgate(texto) {
  const match = String(texto || "").trim().match(/^\/start(?:@[A-Za-z0-9_]+)?\s+resgatar_([A-Za-z0-9_-]{1,100})$/i);
  return match?.[1] || null;
}

export async function processarResgatePontos(update, env) {
  const message = update?.message;
  if (!message) return false;

  const postagemId = extrairPostagemIdResgate(message.text);
  if (!postagemId) return false;

  const userId = Number(message.from?.id);
  const chatId = message.chat?.id;
  if (!userId || !chatId) return true;

  const nome = nomeUsuario(message.from);
  const idiomaRaw = String(message.from?.language_code || "pt").slice(0, 2).toLowerCase();
  const idioma = ["pt", "en", "es"].includes(idiomaRaw) ? idiomaRaw : "pt";

  await env.DB.prepare(`
    INSERT INTO usuarios (id, nome, idioma, pontos, criado_em)
    VALUES (?, ?, ?, 0, ?)
    ON CONFLICT(id) DO UPDATE SET nome = excluded.nome
  `).bind(userId, nome, idioma, Date.now()).run();

  const mention = `<a href="tg://user?id=${userId}">${escHTML(nome)}</a>`;
  const confronto = (await getConfig(env.DB, `confronto_${postagemId}`)) ||
    (await getConfig(env.DB, "confronto_atual")) ||
    "Flamengo";
  const resultadoOficial = (await getConfig(env.DB, `resultado_oficial_${postagemId}`)) || "Resultado Oficial";
  const encerradoEm = Number(await getConfig(env.DB, `bolao_encerrado_em_${postagemId}`)) || 0;
  const aindaEmRevisao = encerradoEm > 0 && Date.now() - encerradoEm < 60 * 60 * 1000;

  const palpiteRow = await env.DB.prepare(
    "SELECT palpite FROM palpites WHERE postagem_id = ? AND user_id = ?"
  ).bind(postagemId, userId).first();

  const palpite = palpiteRow?.palpite || "";
  const textoPalpite = palpite ? `\n📌 Seu palpite: <b>${escHTML(palpite)}</b>` : "";

  const acertoExistente = await env.DB.prepare(
    "SELECT resgatado FROM acertos WHERE postagem_id = ? AND user_id = ?"
  ).bind(postagemId, userId).first();

  if (Number(acertoExistente?.resgatado) === 1) {
    await setConfig(env.DB, `resgate_concluido_${postagemId}_${userId}`, "true");
    await sendMessage(
      env,
      chatId,
      `✅ ${mention}, este ponto já foi resgatado.\n\n🏟 <b>Bolão:</b> ${escHTML(confronto)}\n⚽ <b>Resultado:</b> ${escHTML(resultadoOficial)}${textoPalpite}`
    );
    return true;
  }

  const vencedoresIds = parseVencedores(await getConfig(env.DB, `vencedores_ids_${postagemId}`));
  const placarPalpite = normalizarPlacar(palpite);
  const placarOficial = normalizarPlacar(resultadoOficial);

  // O D1 é a fonte da verdade do palpite. A lista de vencedores continua sendo aceita,
  // mas um palpite que bate exatamente com o placar oficial também é reconhecido.
  const ganhouPorLista = vencedoresIds.includes(String(userId));
  const ganhouPorPlacar = Boolean(placarPalpite && placarOficial && placarPalpite === placarOficial);
  const ganhou = ganhouPorLista || ganhouPorPlacar;

  if (!ganhou) {
    await setConfig(env.DB, `resgate_verificado_${postagemId}_${userId}`, "true");
    const revisao = aindaEmRevisao ? "\n\n🕒 O resultado ainda está no período de revisão de 1 hora." : "";

    await sendMessage(
      env,
      chatId,
      `😔 ${mention}, você não faturou este bolão.\n\n🏟 <b>Bolão:</b> ${escHTML(confronto)}\n⚽ <b>Resultado:</b> ${escHTML(resultadoOficial)}${textoPalpite}\n\n❌ Status: <b>Você perdeu.</b>${revisao}`
    );
    return true;
  }

  const agora = Date.now();
  const placarFinal = palpite || resultadoOficial;

  const claim = await env.DB.prepare(`
    INSERT INTO acertos (postagem_id, user_id, confronto, placar, resgatado, resgatado_em)
    VALUES (?, ?, ?, ?, 1, ?)
    ON CONFLICT(postagem_id, user_id) DO UPDATE SET
      confronto = excluded.confronto,
      placar = excluded.placar,
      resgatado = 1,
      resgatado_em = excluded.resgatado_em
    WHERE COALESCE(acertos.resgatado, 0) = 0
  `).bind(postagemId, userId, confronto, placarFinal, agora).run();

  const alterou = Number(claim?.meta?.changes || 0) > 0;

  if (!alterou) {
    await setConfig(env.DB, `resgate_concluido_${postagemId}_${userId}`, "true");
    await sendMessage(
      env,
      chatId,
      `✅ ${mention}, este ponto já havia sido processado anteriormente.\n\n🏟 <b>Bolão:</b> ${escHTML(confronto)}\n⚽ <b>Resultado:</b> ${escHTML(resultadoOficial)}${textoPalpite}`
    );
    return true;
  }

  await env.DB.prepare("UPDATE usuarios SET pontos = pontos + 1 WHERE id = ?").bind(userId).run();
  await setConfig(env.DB, `resgate_concluido_${postagemId}_${userId}`, "true");

  const userAtualizado = await env.DB.prepare("SELECT pontos FROM usuarios WHERE id = ?").bind(userId).first();
  const total = Number(userAtualizado?.pontos || 0);
  const jaVerificou = await getConfig(env.DB, `resgate_verificado_${postagemId}_${userId}`);
  const textoExtra = jaVerificou === "true"
    ? "\n🛠 Seu acerto foi reconhecido após a conferência manual."
    : ganhouPorPlacar && !ganhouPorLista
      ? "\n🛠 Seu acerto foi reconhecido diretamente pelo placar salvo no D1."
      : "";

  await sendMessage(
    env,
    chatId,
    `🎯 ${mention}, seu acerto foi reconhecido! ❤️🖤\n\n🏆 <b>Bolão:</b> ${escHTML(confronto)}\n⚽ <b>Resultado:</b> ${escHTML(resultadoOficial)}${textoPalpite}\n\n✅ Status: <b>Você ganhou!</b>${textoExtra}\n\n➕ Ponto adicionado uma única vez.\n📊 Total de acertos: <b>${total}</b>`
  );

  return true;
}
