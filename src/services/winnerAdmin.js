import { answerCallbackQuery, editMessage } from "./telegram.js";

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

function parseLista(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function adminId(env) {
  return String(env?.ADMIN_TELEGRAM_ID || "7717528550");
}

async function localizarBolaoDoPalpite(env, targetUserId, msgIdComentario) {
  const palpite = await env.DB.prepare(`
    SELECT postagem_id, palpite, chat_id
    FROM palpites
    WHERE user_id = ? AND mensagem_id = ?
    ORDER BY CAST(criado_em AS INTEGER) DESC
    LIMIT 1
  `).bind(targetUserId, Number(msgIdComentario)).first();

  if (palpite?.postagem_id) {
    return { postagemId: String(palpite.postagem_id), palpite };
  }

  const postagemId =
    (await getConfig(env.DB, "postagem_ativa_id")) ||
    (await getConfig(env.DB, "BOLAO_RESGATE_ID"));

  return { postagemId: postagemId ? String(postagemId) : "", palpite: null };
}

async function confirmarGanhador(update, env, data) {
  const callback = update.callback_query;
  const chatId = callback.message?.chat?.id;
  const messageId = callback.message?.message_id;
  const adminUserId = String(callback.from?.id || "");

  if (adminUserId !== adminId(env)) {
    await answerCallbackQuery(env, callback.id, "Acesso negado.", true);
    return true;
  }

  const match = data.match(/^confirm_ganhou_(\d+)_(\d+)_(.+)$/);
  if (!match) {
    await answerCallbackQuery(env, callback.id, "Dados inválidos.", true);
    return true;
  }

  const targetUserId = Number(match[1]);
  const msgIdComentario = Number(match[2]);
  const placarCravado = String(match[3] || "Cravado").trim();

  await answerCallbackQuery(env, callback.id, "Salvando vencedor...");

  const { postagemId, palpite } = await localizarBolaoDoPalpite(env, targetUserId, msgIdComentario);
  if (!postagemId) {
    await editMessage(
      env,
      chatId,
      messageId,
      "❌ <b>Não foi possível identificar o bolão deste palpite.</b>\n\nNenhuma pontuação foi alterada."
    );
    return true;
  }

  const userDb = await env.DB.prepare("SELECT nome, pontos FROM usuarios WHERE id = ?")
    .bind(targetUserId)
    .first();
  const nome = String(userDb?.nome || "Torcedor").trim() || "Torcedor";

  const bolaoDb = await env.DB.prepare("SELECT confronto FROM boloes WHERE postagem_id = ?")
    .bind(postagemId)
    .first();
  const confronto =
    (await getConfig(env.DB, `confronto_${postagemId}`)) ||
    bolaoDb?.confronto ||
    (await getConfig(env.DB, "confronto_atual")) ||
    "Flamengo";

  await env.DB.prepare(`
    INSERT INTO boloes (postagem_id, confronto, criado_em)
    VALUES (?, ?, ?)
    ON CONFLICT(postagem_id) DO UPDATE SET confronto = excluded.confronto
  `).bind(postagemId, confronto, Date.now()).run();

  const acertoExistente = await env.DB.prepare(
    "SELECT resgatado FROM acertos WHERE postagem_id = ? AND user_id = ?"
  ).bind(postagemId, targetUserId).first();

  const chavePonto = `ganhou_ponto_${postagemId}_${targetUserId}`;
  const marcadorPonto = await getConfig(env.DB, chavePonto);
  const pontoJaConcedido = marcadorPonto === "true" || Boolean(acertoExistente);

  if (!pontoJaConcedido) {
    await env.DB.prepare(`
      INSERT INTO usuarios (id, nome, pontos, criado_em)
      VALUES (?, ?, 1, ?)
      ON CONFLICT(id) DO UPDATE SET
        nome = excluded.nome,
        pontos = COALESCE(usuarios.pontos, 0) + 1
    `).bind(targetUserId, nome, Date.now()).run();
    await setConfig(env.DB, chavePonto, "true");
  }

  const placarFinal = palpite?.palpite || placarCravado;
  await env.DB.prepare(`
    INSERT INTO acertos (postagem_id, user_id, confronto, placar, resgatado, resgatado_em)
    VALUES (?, ?, ?, ?, 0, NULL)
    ON CONFLICT(postagem_id, user_id) DO UPDATE SET
      confronto = excluded.confronto,
      placar = CASE
        WHEN excluded.placar IS NOT NULL AND excluded.placar != '' THEN excluded.placar
        ELSE acertos.placar
      END,
      resgatado = CASE WHEN acertos.resgatado = 1 THEN 1 ELSE 0 END,
      resgatado_em = CASE WHEN acertos.resgatado = 1 THEN acertos.resgatado_em ELSE NULL END
  `).bind(postagemId, targetUserId, confronto, placarFinal).run();

  const vencedores = parseLista(await getConfig(env.DB, `vencedores_ids_${postagemId}`));
  if (!vencedores.includes(String(targetUserId))) {
    vencedores.push(String(targetUserId));
    await setConfig(env.DB, `vencedores_ids_${postagemId}`, JSON.stringify(vencedores));
  }

  const chatOrigem = palpite?.chat_id || chatId;
  const chatIdLimpo = String(chatOrigem || "").replace("-100", "");
  const linkPalpite = chatIdLimpo && msgIdComentario
    ? ` <a href="https://t.me/c/${chatIdLimpo}/${msgIdComentario}">(Ver Palpite)</a>`
    : "";
  const entrada = `🥇 <a href="tg://user?id=${targetUserId}">${escHTML(nome)}</a>${linkPalpite}`;

  const listaAtual = String((await getConfig(env.DB, "vencedores_temporarios")) || "");
  if (!listaAtual.includes(`tg://user?id=${targetUserId}`)) {
    await setConfig(
      env.DB,
      "vencedores_temporarios",
      listaAtual ? `${listaAtual}\n${entrada}` : entrada
    );
  }

  const userAtualizado = await env.DB.prepare("SELECT pontos FROM usuarios WHERE id = ?")
    .bind(targetUserId)
    .first();
  const pontos = Number(userAtualizado?.pontos || 0);

  const statusPonto = pontoJaConcedido
    ? "ℹ️ <b>Ponto:</b> já estava contabilizado; nenhum ponto duplicado foi adicionado."
    : "➕ <b>Ponto:</b> +1 adicionado ao ranking.";

  await editMessage(
    env,
    chatId,
    messageId,
    `✅ <b>PALPITE VENCEDOR SALVO PARA RESGATE</b>\n\n` +
      `👤 <b>Torcedor:</b> <a href="tg://user?id=${targetUserId}">${escHTML(nome)}</a>\n` +
      `🏟 <b>Partida:</b> ${escHTML(confronto)}\n` +
      `📌 <b>Palpite:</b> <code>${escHTML(placarFinal)}</code>\n` +
      `${statusPonto}\n` +
      `📊 <b>Total atual:</b> ${pontos} ponto(s).\n\n` +
      `🎁 <b>Status do resgate:</b> aguardando o torcedor usar o botão de resgate.`,
    null
  );

  return true;
}

async function cancelarGanhador(update, env) {
  const callback = update.callback_query;
  if (String(callback.from?.id || "") !== adminId(env)) {
    await answerCallbackQuery(env, callback.id, "Acesso negado.", true);
    return true;
  }

  await answerCallbackQuery(env, callback.id, "Ação cancelada.");
  await editMessage(
    env,
    callback.message?.chat?.id,
    callback.message?.message_id,
    "❌ <b>Registro de vencedor cancelado.</b> Nenhuma alteração foi feita.",
    null
  );
  return true;
}

export async function processarCallbackGanhou(update, env) {
  const data = String(update?.callback_query?.data || "");
  if (data.startsWith("confirm_ganhou_")) {
    try {
      return await confirmarGanhador(update, env, data);
    } catch (error) {
      console.error("confirmarGanhador", error);
      try {
        await answerCallbackQuery(env, update.callback_query.id, "Erro ao salvar vencedor.", true);
      } catch {}
      return true;
    }
  }

  if (data === "cancel_ganhou") {
    try {
      return await cancelarGanhador(update, env);
    } catch (error) {
      console.error("cancelarGanhador", error);
      return true;
    }
  }

  return false;
}
