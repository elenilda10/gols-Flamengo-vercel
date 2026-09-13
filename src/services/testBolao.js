import { answerCallbackQuery, sendMessage, telegramRequest } from "./telegram.js";

const ADMIN_FALLBACK = "7717528550";

function adminId(env) {
  return String(env?.ADMIN_TELEGRAM_ID || ADMIN_FALLBACK);
}

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function nome(from) {
  return `${from?.first_name || ""} ${from?.last_name || ""}`.trim() || "Torcedor";
}

export function normalizarPlacarTeste(value) {
  const match = String(value || "").match(/(\d{1,2})\s*(?:x|X|×|-|a|:)\s*(\d{1,2})/i);
  return match ? `${Number(match[1])}x${Number(match[2])}` : "";
}

export async function garantirEstruturaBolaoTeste(env) {
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS test_config (chave TEXT PRIMARY KEY, valor TEXT)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS test_usuarios (id INTEGER PRIMARY KEY, nome TEXT NOT NULL DEFAULT 'Torcedor', pontos INTEGER NOT NULL DEFAULT 0, criado_em INTEGER)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS test_boloes (postagem_id TEXT PRIMARY KEY, confronto TEXT, criado_em INTEGER)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS test_palpites (postagem_id TEXT NOT NULL, user_id INTEGER NOT NULL, palpite TEXT NOT NULL, mensagem_id INTEGER, chat_id TEXT, reagido INTEGER NOT NULL DEFAULT 0, criado_em INTEGER, PRIMARY KEY (postagem_id, user_id))`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS test_acertos (postagem_id TEXT NOT NULL, user_id INTEGER NOT NULL, confronto TEXT, placar TEXT, resgatado INTEGER NOT NULL DEFAULT 0, resgatado_em INTEGER, PRIMARY KEY (postagem_id, user_id))`)
  ]);
}

export async function getTestConfig(env, chave) {
  await garantirEstruturaBolaoTeste(env);
  const row = await env.DB.prepare("SELECT valor FROM test_config WHERE chave = ?").bind(chave).first();
  return row?.valor ?? null;
}

export async function setTestConfig(env, chave, valor) {
  await garantirEstruturaBolaoTeste(env);
  await env.DB.prepare("INSERT OR REPLACE INTO test_config (chave, valor) VALUES (?, ?)").bind(chave, String(valor)).run();
}

export async function deleteTestConfig(env, chave) {
  await garantirEstruturaBolaoTeste(env);
  await env.DB.prepare("DELETE FROM test_config WHERE chave = ?").bind(chave).run();
}

async function iniciarTeste(update, env, texto) {
  const message = update.message;
  if (String(message.from?.id || "") !== adminId(env)) return true;

  const params = texto.replace(/^\/teste_iniciar_bolao(?:@[A-Za-z0-9_]+)?\s*/i, "").trim();
  const partes = params.split("|");
  if (partes.length < 2 || !partes[0].trim() || !partes.slice(1).join("|").trim()) {
    await sendMessage(env, message.chat.id, "❌ Use: <code>/teste_iniciar_bolao Flamengo x Vasco 21h | FILE_ID_FOTO</code>");
    return true;
  }

  const confronto = partes[0].trim();
  const foto = partes.slice(1).join("|").trim();
  const destino = String(env?.TEST_BOLAO_CHAT_ID || "").trim();

  if (!destino) {
    await sendMessage(
      env,
      message.chat.id,
      "❌ <b>Canal de teste não configurado.</b>\n\n" +
        "Crie no Worker a variável <code>TEST_BOLAO_CHAT_ID</code> com o ID ou @username do canal de testes.\n\n" +
        "Exemplo: <code>@MeuCanalBolaoTeste</code>\n\n" +
        "O bolão de teste não será publicado no privado para evitar misturar o fluxo de comentários."
    );
    return true;
  }

  await garantirEstruturaBolaoTeste(env);
  await deleteTestConfig(env, "postagem_ativa_id");
  await setTestConfig(env, "bolao_aberto", "false");
  await setTestConfig(env, "confronto_atual", confronto);
  await setTestConfig(env, "canal_destino", destino);

  const legenda =
    `🧪 <b>BOLÃO DE TESTE</b>\n\n` +
    `🏟 <b>Partida:</b> ${esc(confronto)}\n\n` +
    `💬 Envie seu palpite nos <b>comentários desta postagem</b> com um placar como <b>2x1</b>.\n` +
    `⚠️ Este ambiente é isolado e <b>não altera o ranking real</b>.`;

  let post;
  try {
    post = await telegramRequest(env, "sendPhoto", {
      chat_id: destino,
      photo: foto,
      caption: legenda,
      parse_mode: "HTML"
    });
  } catch (error) {
    await setTestConfig(env, "bolao_aberto", "false");
    await deleteTestConfig(env, "postagem_ativa_id");

    const detalhe = String(error?.message || error || "Erro desconhecido");
    try {
      await sendMessage(
        env,
        message.chat.id,
        `❌ <b>Não foi possível iniciar o bolão de teste.</b>\n\n` +
          `🏟 <b>Confronto:</b> ${esc(confronto)}\n` +
          `📍 <b>Canal de teste:</b> <code>${esc(destino)}</code>\n` +
          `⚠️ <b>Erro:</b> <code>${esc(detalhe)}</code>\n\n` +
          `Verifique se o bot é administrador do canal e pode publicar mensagens.`
      );
    } catch (avisoError) {
      console.error("Falha ao avisar erro do bolão de teste", avisoError);
    }

    console.error("Erro ao publicar bolão de teste", { detalhe, destino, confronto });
    return true;
  }

  if (!post?.message_id) {
    await setTestConfig(env, "bolao_aberto", "false");
    await deleteTestConfig(env, "postagem_ativa_id");
    await sendMessage(env, message.chat.id, "❌ O Telegram não retornou o ID da postagem de teste. Nenhum bolão foi aberto.");
    return true;
  }

  const postId = String(post.message_id);
  await setTestConfig(env, "postagem_ativa_id", postId);
  await setTestConfig(env, "bolao_aberto", "true");
  await setTestConfig(env, `confronto_${postId}`, confronto);
  await env.DB.prepare(`INSERT INTO test_boloes (postagem_id, confronto, criado_em) VALUES (?, ?, ?) ON CONFLICT(postagem_id) DO UPDATE SET confronto = excluded.confronto`).bind(postId, confronto, Date.now()).run();

  await sendMessage(
    env,
    message.chat.id,
    `✅ <b>Bolão de teste publicado no canal.</b>\n` +
      `📍 Canal: <code>${esc(destino)}</code>\n` +
      `📌 Post: <code>${postId}</code>\n` +
      `🏟 <b>${esc(confronto)}</b>\n\n` +
      `💬 Os palpites devem chegar pelos comentários da postagem.\n` +
      `🧪 Nenhum dado de produção será alterado.`
  );
  return true;
}

async function fecharTeste(update, env) {
  const message = update.message;
  if (String(message.from?.id || "") !== adminId(env)) return true;
  await setTestConfig(env, "bolao_aberto", "false");
  await sendMessage(env, message.chat.id, "🔒 <b>Bolão de teste fechado.</b>");
  return true;
}

async function ganhouTeste(update, env) {
  const message = update.message;
  if (String(message.from?.id || "") !== adminId(env)) return true;
  const reply = message.reply_to_message;
  if (!reply) {
    await sendMessage(env, message.chat.id, "❌ Use <code>/teste_ganhou</code> respondendo ao palpite vencedor do ambiente de teste.");
    return true;
  }

  const targetUserId = Number(reply.from?.id);
  const placar = normalizarPlacarTeste(reply.text || reply.caption || "");
  if (!targetUserId || !placar) {
    await sendMessage(env, message.chat.id, "❌ Não consegui identificar usuário ou placar desse palpite.");
    return true;
  }

  const postId = await getTestConfig(env, "postagem_ativa_id");
  if (!postId) {
    await sendMessage(env, message.chat.id, "❌ Nenhum bolão de teste ativo.");
    return true;
  }

  const teclado = [[
    { text: "✅ Confirmar vencedor TESTE", callback_data: `test_confirm_ganhou_${targetUserId}_${reply.message_id}_${placar}` },
    { text: "❌ Cancelar", callback_data: "test_cancel_ganhou" }
  ]];

  await sendMessage(
    env,
    message.chat.id,
    `🧪 <b>CONFIRMAR VENCEDOR DO TESTE?</b>\n\n👤 ${esc(nome(reply.from))}\n📌 Palpite: <code>${placar}</code>\n\nNada será lançado no ranking real.`,
    teclado,
    { reply_to_message_id: reply.message_id }
  );
  return true;
}

async function resgatarTeste(update, env, texto) {
  const message = update.message;
  const match = texto.match(/^\/start(?:@[A-Za-z0-9_]+)?\s+teste_resgatar_([A-Za-z0-9_-]+)$/i);
  if (!match) return false;

  await garantirEstruturaBolaoTeste(env);
  const postId = match[1];
  const uid = Number(message.from?.id);
  const acerto = await env.DB.prepare("SELECT * FROM test_acertos WHERE postagem_id = ? AND user_id = ?").bind(postId, uid).first();
  if (!acerto) {
    await sendMessage(env, message.chat.id, "❌ Você não está registrado como vencedor deste bolão de teste.");
    return true;
  }

  if (Number(acerto.resgatado) !== 1) {
    await env.DB.prepare("UPDATE test_acertos SET resgatado = 1, resgatado_em = ? WHERE postagem_id = ? AND user_id = ?").bind(Date.now(), postId, uid).run();
  }

  const user = await env.DB.prepare("SELECT pontos FROM test_usuarios WHERE id = ?").bind(uid).first();
  await sendMessage(env, message.chat.id,
    `🧪 <b>RESGATE DE TESTE CONFIRMADO</b>\n\n🏟 ${esc(acerto.confronto || "Bolão de teste")}\n📌 Palpite: <code>${esc(acerto.placar || "-")}</code>\n📊 Pontos no ranking de teste: <b>${Number(user?.pontos || 0)}</b>\n\n✅ O ranking real não foi alterado.`
  );
  return true;
}

async function capturarPalpiteTeste(update, env, texto) {
  const message = update.message;
  const placar = normalizarPlacarTeste(texto);
  if (!placar) return false;
  if ((await getTestConfig(env, "bolao_aberto")) !== "true") return false;

  const postId = await getTestConfig(env, "postagem_ativa_id");
  if (!postId) return false;

  const reply = message.reply_to_message;
  const threadId = message.message_thread_id;
  const relacionado = Boolean(
    (reply && String(reply.message_id) === String(postId)) ||
    (threadId && String(threadId) === String(postId)) ||
    (reply && String(reply.forward_from_message_id || "") === String(postId)) ||
    (reply?.forward_origin && String(reply.forward_origin.message_id || "") === String(postId))
  );
  if (!relacionado) return false;

  await garantirEstruturaBolaoTeste(env);
  const uid = Number(message.from?.id);
  await env.DB.prepare(`INSERT INTO test_usuarios (id, nome, pontos, criado_em) VALUES (?, ?, 0, ?) ON CONFLICT(id) DO UPDATE SET nome = excluded.nome`).bind(uid, nome(message.from), Date.now()).run();

  const existente = await env.DB.prepare("SELECT palpite FROM test_palpites WHERE postagem_id = ? AND user_id = ?").bind(postId, uid).first();
  if (existente) {
    await sendMessage(env, message.chat.id, `⚠️ <b>TESTE:</b> você já registrou <code>${esc(existente.palpite)}</code> neste bolão.`, null, { reply_to_message_id: message.message_id });
    return true;
  }

  await env.DB.prepare(`INSERT INTO test_palpites (postagem_id, user_id, palpite, mensagem_id, chat_id, reagido, criado_em) VALUES (?, ?, ?, ?, ?, 1, ?)`).bind(postId, uid, placar, message.message_id, String(message.chat.id), Date.now()).run();
  try {
    await telegramRequest(env, "setMessageReaction", {
      chat_id: message.chat.id,
      message_id: message.message_id,
      reaction: [{ type: "emoji", emoji: "👍" }],
      is_big: false
    });
  } catch {}
  return true;
}

export async function processarBolaoTeste(update, env) {
  const message = update?.message;
  if (!message) return false;
  const texto = String(message.text || message.caption || "").trim();

  if (/^\/teste_iniciar_bolao(?:@|\s|$)/i.test(texto)) return iniciarTeste(update, env, texto);
  if (/^\/teste_fechar_bolao(?:@|\s|$)/i.test(texto)) return fecharTeste(update, env);
  if (/^\/teste_ganhou(?:@|\s|$)/i.test(texto)) return ganhouTeste(update, env);
  if (/^\/start(?:@[A-Za-z0-9_]+)?\s+teste_resgatar_/i.test(texto)) return resgatarTeste(update, env, texto);

  return capturarPalpiteTeste(update, env, texto);
}
