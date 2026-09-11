import { encaminharParaMotorAtual } from "./legacyAdapter.js";

export async function handleInlineQuery(update, env) {
    if (!update?.inline_query) {
        return new Response("OK", { status: 200 });
    }

    return encaminharParaMotorAtual(update, env);
}
