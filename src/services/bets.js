import { telegramRequest } from "./telegram.js";

async function getConfig(db, chave) {
  const row = await db.prepare("SELECT valor FROM config WHERE chave = ?").bind(chave).first();
  return row ? row.valor : null;
}

function normalizarPlacar(valor) {
  const texto = String(valor || "").trim().toLowerCase();
  const match = texto.match(/(\d+)\s*(?:x|×|-|a|:)\s*(\d+)/i);
  if (!match) return "";
  return `${Number(match[1])}x${Number(match[2])}`;
}

function limparNome(from) {
  const nome = `${from?.first_name || ""} ${from?.last_name || ""}`
    .replace(/[\u0000-\u001F\u007F-\u009F\uFFFD]/g, "")
    .trim();
  return nome || "Torcedor";
}

export async function processarPalpiteAutomatico(update, env) {
  const message = update?.message;
  if (!message?.from || message.from.is_bot) return false;

  const chatType = message.chat?.type;
  if (chatType !== "group" && chatType !== "supergroup") return false;

  const texto = String(message.text || message.caption || "").trim();
  if (!texto || texto.startsWith("/")) return false;

  const placar = normalizarPlacar(texto);
  if (!placar) return false;

  const bolaoAberto = await getConfig(env.DB, "bolao_aberto");
  if (bolaoAberto !== "true") return false;

  const postagemId = (await getConfig(env.DB, "postagem_ativa_id")) ||
    (await getConfig(env.DB, "BOLAO_RESGATE_ID"));
  if (!postagemId) return false;

  const userId = Number(message.from.id);
  const nome = limparNome(message.from);
  const agora = Date.now();

  await env.DB.prepare(`
    INSERT INTO usuarios (id, nome, pontos, criado_em)
    VALUES (?, ?, 0, ?)
    ON CONFLICT(id) DO UPDATE SET nome = excluded.nome
  `).bind(userId, nome, agora).run();

  const gravacao = await env.DB.prepare(`
    INSERT OR IGNORE INTO palpites
      (postagem_id, user_id, palpite, mensagem_id, chat_id, reagido, criado_em)
    VALUES (?, ?, ?, ?, ?, 1, ?)
  `).bind(
    String(postagemId),
    userId,
    placar,
    message.message_id,
    message.chat.id,
    agora
  ).run();

  const inseriu = Number(gravacao?.meta?.changes || 0) > 0;
  if (!inseriu) return false;

  try {
    await telegramRequest(env, "setMessageReaction", {
      chat_id: message.chat.id,
      message_id: message.message_id,
      reaction: [{ type: "emoji", emoji: "👍" }],
      is_big: false
    });
  } catch (error) {
    console.error("Falha ao reagir ao palpite salvo", error);
  }

  return true;
}
