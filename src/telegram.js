import { handleMessage } from "./handlers/messageHandler.js";
import { handleCallback } from "./handlers/callbackHandler.js";
import { handleInlineQuery } from "./handlers/inlineQueryHandler.js";

export async function processarWebhookTelegram(request, env) {
    let update;

    try {
        update = await request.json();
    } catch {
        return new Response("Invalid JSON", { status: 400 });
    }

    if (update?.inline_query) {
        return handleInlineQuery(update, env);
    }

    if (update?.callback_query) {
        return handleCallback(update, env);
    }

    if (update?.message) {
        return handleMessage(update, env);
    }

    return new Response("OK", { status: 200 });
}
