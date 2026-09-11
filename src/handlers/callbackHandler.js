import { encaminharParaMotorAtual } from "./legacyAdapter.js";

export async function handleCallback(update, env) {
    if (!update?.callback_query) {
        return new Response("OK", { status: 200 });
    }

    return encaminharParaMotorAtual(update, env);
}
