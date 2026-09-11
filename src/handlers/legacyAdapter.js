import { processarMensagemTelegram } from "../../telegram_bot.js";

export async function encaminharParaMotorAtual(update, env) {
    const requestInterno = new Request("https://internal.local/webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(update)
    });

    return processarMensagemTelegram(requestInterno, env);
}
