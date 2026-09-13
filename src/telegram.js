import { handleMessage } from "./handlers/messageHandler.js";
import { handleCallback } from "./handlers/callbackHandler.js";
import { handleInlineQuery } from "./handlers/inlineQueryHandler.js";

export async function processarWebhookTelegram(request, env) {
    let update;

    try {
        update = await request.json();
    } catch (error) {
        console.error("[WEBHOOK] JSON inválido", String(error?.message || error));
        return new Response("Invalid JSON", { status: 400 });
    }

    const message = update?.message;
    const tipo = update?.inline_query
        ? "inline_query"
        : update?.callback_query
          ? "callback_query"
          : message
            ? "message"
            : update?.channel_post
              ? "channel_post"
              : update?.edited_message
                ? "edited_message"
                : "outro";

    console.log("[WEBHOOK] update recebido", {
        update_id: update?.update_id ?? null,
        tipo,
        chat_id: message?.chat?.id ?? update?.channel_post?.chat?.id ?? null,
        chat_type: message?.chat?.type ?? update?.channel_post?.chat?.type ?? null,
        message_id: message?.message_id ?? update?.channel_post?.message_id ?? null,
        texto: String(message?.text || message?.caption || update?.channel_post?.text || update?.channel_post?.caption || "").slice(0, 120)
    });

    if (update?.inline_query) {
        return handleInlineQuery(update, env);
    }

    if (update?.callback_query) {
        return handleCallback(update, env);
    }

    if (update?.message) {
        return handleMessage(update, env);
    }

    console.log("[WEBHOOK] update sem handler", { update_id: update?.update_id ?? null, tipo });
    return new Response("OK", { status: 200 });
}
