function token(env) {
  if (!env?.TELEGRAM_TOKEN) throw new Error("TELEGRAM_TOKEN não configurado");
  return env.TELEGRAM_TOKEN;
}

export async function telegramRequest(env, method, payload = {}) {
  const response = await fetch(`https://api.telegram.org/bot${token(env)}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error(`Telegram ${method}: resposta inválida (${response.status})`);
  }

  if (!response.ok || !data?.ok) {
    const descricao = data?.description || `HTTP ${response.status}`;
    throw new Error(`Telegram ${method}: ${descricao}`);
  }

  return data.result;
}

export function sendMessage(env, chatId, text, teclado = null, extras = {}) {
  const payload = {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...extras
  };

  if (teclado) payload.reply_markup = { inline_keyboard: teclado };
  return telegramRequest(env, "sendMessage", payload);
}

export async function editMessage(env, chatId, messageId, text, teclado = null, extras = {}) {
  const payload = {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...extras
  };

  if (teclado) payload.reply_markup = { inline_keyboard: teclado };

  try {
    return await telegramRequest(env, "editMessageText", payload);
  } catch (error) {
    if (String(error?.message || "").includes("message is not modified")) return null;
    throw error;
  }
}

export function answerInlineQuery(env, inlineQueryId, results, nextOffset = "") {
  return telegramRequest(env, "answerInlineQuery", {
    inline_query_id: inlineQueryId,
    results,
    cache_time: 0,
    is_personal: true,
    next_offset: nextOffset
  });
}

export function answerCallbackQuery(env, callbackQueryId, text = "", showAlert = false) {
  const payload = { callback_query_id: callbackQueryId, show_alert: showAlert };
  if (text) payload.text = text;
  return telegramRequest(env, "answerCallbackQuery", payload);
}
