import { encaminharParaMotorAtual } from "./legacyAdapter.js";
import { processarResgatePontos } from "../services/redemption.js";
import { processarPalpiteAutomatico } from "../services/bets.js";

export async function handleMessage(update, env) {
    if (!update?.message) {
        return new Response("OK", { status: 200 });
    }

    try {
        const processadoComoResgate = await processarResgatePontos(update, env);
        if (processadoComoResgate) {
            return new Response("OK", { status: 200 });
        }
    } catch (error) {
        console.error("Erro no resgate de pontos", error);
        return new Response("OK", { status: 200 });
    }

    try {
        await processarPalpiteAutomatico(update, env);
    } catch (error) {
        console.error("Erro ao salvar palpite automaticamente", error);
    }

    return encaminharParaMotorAtual(update, env);
}
