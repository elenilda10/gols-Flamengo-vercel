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

export async function processarCorrecaoResgate(update, env) {
  const message = update?.message;
  const texto = String(message?.text || "").trim();

  if (!/^\/corrigir_resgate(?:@[A-Za-z0-9_]+)?\b/i.test(texto)) return false;
  if (String(message?.from?.id || "") !== ADMIN_ID) return true;

  const match = texto.match(/^\/corrigir_resgate(?:@[A-Za-z0-9_]+)?\s+([A-Za-z0-9_-]{1,100})$/i);
  if (!match) {
    await sendMessage(env, message.chat.id, "❌ Use <code>/corrigir_resgate ID_DO_BOLAO</code> respondendo ao palpite original do torcedor.");
    return true;
  }

  const postagemId = match[1];
  const alvo = message.reply_to_message;
  if (!alvo?.from?.id) {
    await sendMessage(env, message.chat.id, "❌ Responda à mensagem original do palpite do torcedor para corrigir o resgate.");
    return true;
  }

  const textoPalpite = String(alvo.text || alvo.caption || "").trim();
  const palpite = normalizarPlacar(textoPalpite);
  if (!palpite) {
    await sendMessage(env, message.chat.id, `❌ Não encontrei um placar válido na mensagem respondida.\n\nMensagem: <code>${escHTML(textoPalpite)}</code>`);
    return true;
  }

  const resultadoOficial = await getConfig(env.DB, `resultado_oficial_${postagemId}`);
  const placarOficial = normalizarPlacar(resultadoOficial);
  if (!resultadoOficial || !placarOficial) {
    await sendMessage(env, message.chat.id, `❌ O bolão <code>${escHTML(postagemId)}</code> não possui resultado oficial válido salvo.`);
    return true;
  }

  if (palpite !== placarOficial) {
    await sendMessage(
      env,
      message.chat.id,
      `❌ O palpite não bate com o resultado oficial.\n\n📌 Palpite: <b>${escHTML(palpite)}</b>\n⚽ Resultado: <b>${escHTML(placarOficial)}</b>`
    );
    return true;
  }

  const targetUserId = Number(alvo.from.id);
  const nome = `${alvo.from.first_name || ""} ${alvo.from.last_name || ""}`.trim() || "Torcedor";
  const confronto = (await getConfig(env.DB, `confronto_${postagemId}`)) || "Flamengo";
  const agora = Date.now();

  await env.DB.prepare(`
    INSERT INTO usuarios (id, nome, pontos, criado_em)
    VALUES (?, ?, 0, ?)
    ON CONFLICT(id) DO UPDATE SET nome = excluded.nome
  `).bind(targetUserId, nome, agora).run();

  await env.DB.prepare(`
    INSERT INTO palpites (postagem_id, user_id, palpite, mensagem_id, chat_id, reagido, criado_em)
    VALUES (?, ?, ?, ?, ?, 1, ?)
    ON CONFLICT(postagem_id, user_id) DO UPDATE SET
      palpite = excluded.palpite,
      mensagem_id = excluded.mensagem_id,
      chat_id = excluded.chat_id,
      reagido = 1
  `).bind(postagemId, targetUserId, palpite, alvo.message_id, message.chat.id, agora).run();

  const claim = await env.DB.prepare(`
    INSERT INTO acertos (postagem_id, user_id, confronto, placar, resgatado, resgatado_em)
    VALUES (?, ?, ?, ?, 1, ?)
    ON CONFLICT(postagem_id, user_id) DO UPDATE SET
      confronto = excluded.confronto,
      placar = excluded.placar,
      resgatado = 1,
      resgatado_em = excluded.resgatado_em
    WHERE COALESCE(acertos.resgatado, 0) = 0
  `).bind(postagemId, targetUserId, confronto, palpite, agora).run();

  const novoPonto = Number(claim?.meta?.changes || 0) > 0;
  if (novoPonto) {
    await env.DB.prepare("UPDATE usuarios SET pontos = pontos + 1 WHERE id = ?").bind(targetUserId).run();
  }

  let vencedores = [];
  try {
    vencedores = JSON.parse((await getConfig(env.DB, `vencedores_ids_${postagemId}`)) || "[]");
    if (!Array.isArray(vencedores)) vencedores = [];
  } catch {
    vencedores = [];
  }
  if (!vencedores.map(String).includes(String(targetUserId))) vencedores.push(String(targetUserId));
  await setConfig(env.DB, `vencedores_ids_${postagemId}`, JSON.stringify(vencedores));
  await setConfig(env.DB, `resgate_concluido_${postagemId}_${targetUserId}`, "true");
  await setConfig(env.DB, `resgate_verificado_${postagemId}_${targetUserId}`, "true");

  const userAtualizado = await env.DB.prepare("SELECT pontos FROM usuarios WHERE id = ?").bind(targetUserId).first();
  const total = Number(userAtualizado?.pontos || 0);

  await sendMessage(
    env,
    message.chat.id,
    `${novoPonto ? "✅" : "ℹ️"} <b>Resgate corrigido</b>\n\n👤 ${escHTML(nome)}\n🏟 ${escHTML(confronto)}\n📌 Palpite: <b>${escHTML(palpite)}</b>\n⚽ Resultado: <b>${escHTML(placarOficial)}</b>\n\n${novoPonto ? "➕ 1 ponto adicionado." : "O ponto já estava contabilizado; nenhum ponto duplicado foi criado."}\n📊 Total: <b>${total}</b>`
  );

  return true;
}
