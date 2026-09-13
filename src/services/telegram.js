function token(env) {
  const value = env?.TELEGRAM_TOKEN || env?.TELEGRAM_BOT_TOKEN;
  if (!value) throw new Error("TELEGRAM_TOKEN/TELEGRAM_BOT_TOKEN não configurado");
  return value;
}

function normalizarPayload(method, payload = {}) {
  const data = { ...payload };

  // Bot API atual usa reply_parameters. Mantemos compatibilidade com o código legado.
  if (data.reply_to_message_id != null && data.reply_parameters == null) {
    data.reply_parameters = {
      message_id: Number(data.reply_to_message_id),
      allow_sending_without_reply: true
    };
    delete data.reply_to_message_id;
  }

  // disable_web_page_preview foi substituído por link_preview_options.
  if (data.disable_web_page_preview != null && data.link_preview_options == null) {
    data.link_preview_options = { is_disabled: Boolean(data.disable_web_page_preview) };
    delete data.disable_web_page_preview;
  }

  return data;
}

export async function telegramRequest(env, method, payload = {}) {
  const response = await fetch(`https://api.telegram.org/bot${token(env)}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(normalizarPayload(method, payload))
  });

  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error(`Telegram ${method}: resposta inválida (${response.status})`);
  }

  if (!response.ok || !data?.ok) {
    const descricao = data?.description || `HTTP ${response.status}`;
    const codigo = data?.error_code ? ` [${data.error_code}]` : "";
    const parametros = data?.parameters ? ` ${JSON.stringify(data.parameters)}` : "";
    throw new Error(`Telegram ${method}${codigo}: ${descricao}${parametros}`);
  }

  return data.result;
}

export function sendMessage(env, chatId, text, teclado = null, extras = {}) {
  const payload = {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
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
    link_preview_options: { is_disabled: true },
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
