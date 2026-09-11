import { sendMessage } from "./telegram.js";
import { normalizarPlacar } from "./redemption.js";

const ADMIN_ID = "7717528550";

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

async function salvarHistoricoAcerto(env, {
  postagemId,
  userId,
  nome,
  palpite,
  confronto,
  mensagemId,
  chatId
}) {
  const agora = Date.now();

  await env.DB.prepare(`
    INSERT INTO usuarios (id, nome, pontos, criado_em)
    VALUES (?, ?, 0, ?)
    ON CONFLICT(id) DO UPDATE SET nome = excluded.nome
  `).bind(userId, nome, agora).run();

  await env.DB.prepare(`
    INSERT INTO palpites (postagem_id, user_id, palpite, mensagem_id, chat_id, reagido, criado_em)
    VALUES (?, ?, ?, ?, ?, 1, ?)
    ON CONFLICT(postagem_id, user_id) DO UPDATE SET
      palpite = excluded.palpite,
      mensagem_id = excluded.mensagem_id,
      chat_id = excluded.chat_id,
      reagido = 1
  `).bind(postagemId, userId, palpite, mensagemId, chatId, agora).run();

  // Este fluxo corrige apenas o histórico. A pontuação já foi contabilizada antes.
  await env.DB.prepare(`
    INSERT INTO acertos (postagem_id, user_id, confronto, placar, resgatado, resgatado_em)
    VALUES (?, ?, ?, ?, 1, ?)
    ON CONFLICT(postagem_id, user_id) DO UPDATE SET
      confronto = excluded.confronto,
      placar = excluded.placar,
      resgatado = 1,
      resgatado_em = COALESCE(acertos.resgatado_em, excluded.resgatado_em)
  `).bind(postagemId, userId, confronto, palpite, agora).run();

  let vencedores = [];
  try {
    vencedores = JSON.parse((await getConfig(env.DB, `vencedores_ids_${postagemId}`)) || "[]");
    if (!Array.isArray(vencedores)) vencedores = [];
  } catch {
    vencedores = [];
  }

  if (!vencedores.map(String).includes(String(userId))) {
    vencedores.push(String(userId));
  }

  await setConfig(env.DB, `vencedores_ids_${postagemId}`, JSON.stringify(vencedores));
  await setConfig(env.DB, `resgate_concluido_${postagemId}_${userId}`, "true");
  await setConfig(env.DB, `resgate_verificado_${postagemId}_${userId}`, "true");
}

export async function processarCorrecaoResgate(update, env) {
  const message = update?.message;
  const texto = String(message?.text || "").trim();

  if (!/^\/corrigir_resgate(?:@[A-Za-z0-9_]+)?\b/i.test(texto)) return false;
  if (String(message?.from?.id || "") !== ADMIN_ID) return true;

  const match = texto.match(/^\/corrigir_resgate(?:@[A-Za-z0-9_]+)?\s+([A-Za-z0-9_-]{1,100})$/i);
  if (!match) {
    await sendMessage(
      env,
      message.chat.id,
      "❌ Use <code>/corrigir_resgate ID_DO_BOLAO</code> respondendo ao palpite original do torcedor."
    );
    return true;
  }

  const postagemId = match[1];
  const alvo = message.reply_to_message;

  if (!alvo?.from?.id) {
    await sendMessage(
      env,
      message.chat.id,
      "❌ Responda à mensagem original do palpite do torcedor para salvar o histórico do acerto."
    );
    return true;
  }

  const textoPalpite = String(alvo.text || alvo.caption || "").trim();
  const palpite = normalizarPlacar(textoPalpite);

  if (!palpite) {
    await sendMessage(
      env,
      message.chat.id,
      `❌ Não encontrei um placar válido na mensagem respondida.\n\nMensagem: <code>${escHTML(textoPalpite)}</code>`
    );
    return true;
  }

  const resultadoOficial = await getConfig(env.DB, `resultado_oficial_${postagemId}`);
  const placarOficial = normalizarPlacar(resultadoOficial);

  if (!resultadoOficial || !placarOficial) {
    await sendMessage(
      env,
      message.chat.id,
      `❌ O bolão <code>${escHTML(postagemId)}</code> não possui resultado oficial válido salvo.`
    );
    return true;
  }

  if (palpite !== placarOficial) {
    await sendMessage(
      env,
      message.chat.id,
      `❌ O palpite não bate com o resultado oficial.\n\n📌 Palpite: <b>${escHTML(palpite)}</b>\n⚽ Resultado: <b>${escHTML(placarOficial)}</b>\n\nℹ️ Nenhuma pontuação ou histórico foi alterado.`
    );
    return true;
  }

  const targetUserId = Number(alvo.from.id);
  const nome = `${alvo.from.first_name || ""} ${alvo.from.last_name || ""}`.trim() || "Torcedor";
  const confronto = (await getConfig(env.DB, `confronto_${postagemId}`)) || "Flamengo";

  const usuarioAntes = await env.DB.prepare("SELECT pontos FROM usuarios WHERE id = ?")
    .bind(targetUserId)
    .first();
  const pontosAntes = Number(usuarioAntes?.pontos || 0);

  await salvarHistoricoAcerto(env, {
    postagemId,
    userId: targetUserId,
    nome,
    palpite,
    confronto,
    mensagemId: alvo.message_id,
    chatId: message.chat.id
  });

  const usuarioDepois = await env.DB.prepare("SELECT pontos FROM usuarios WHERE id = ?")
    .bind(targetUserId)
    .first();
  const pontosDepois = Number(usuarioDepois?.pontos || 0);

  await sendMessage(
    env,
    message.chat.id,
    `✅ <b>HISTÓRICO DO ACERTO SALVO</b>\n\n` +
      `👤 <b>Torcedor:</b> ${escHTML(nome)}\n` +
      `🏟 <b>Partida acertada:</b> ${escHTML(confronto)}\n` +
      `📌 <b>Palpite salvo:</b> ${escHTML(palpite)}\n` +
      `⚽ <b>Resultado oficial:</b> ${escHTML(placarOficial)}\n` +
      `🆔 <b>Bolão:</b> <code>${escHTML(postagemId)}</code>\n\n` +
      `💾 O palpite e a partida foram registrados no histórico de acertos.\n` +
      `📊 <b>Pontuação mantida:</b> ${pontosDepois} ponto(s).\n` +
      `🚫 <b>Nenhum ponto novo foi adicionado.</b>` +
      (pontosAntes !== pontosDepois ? `\n⚠️ Atenção: a pontuação mudou de ${pontosAntes} para ${pontosDepois} durante o processamento.` : "")
  );

  return true;
}
