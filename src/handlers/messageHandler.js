import { encaminharParaMotorAtual } from "./legacyAdapter.js";

export async function handleMessage(update, env) {
    if (!update?.message) {
        return new Response("OK", { status: 200 });
    }

    return encaminharParaMotorAtual(update, env);
}
