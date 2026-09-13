import { encaminharParaMotorAtual } from "./legacyAdapter.js";
import { processarResgatePontos } from "../services/redemption.js";
import { processarPalpiteAutomatico } from "../services/bets.js";
import { processarCorrecaoResgate } from "../services/redemptionAdmin.js";
import { processarBolaoTeste } from "../services/testBolao.js";

export async function handleMessage(update, env) {
    if (!update?.message) {
        return new Response("OK", { status: 200 });
    }

    try {
        const processadoComoTeste = await processarBolaoTeste(update, env);
        if (processadoComoTeste) {
            return new Response("OK", { status: 200 });
        }
    } catch (error) {
        console.error("Erro no ambiente de teste do bolão", error);
        return new Response("OK", { status: 200 });
    }

    try {
        const processadoComoCorrecao = await processarCorrecaoResgate(update, env);
        if (processadoComoCorrecao) {
            return new Response("OK", { status: 200 });
        }
    } catch (error) {
        console.error("Erro na correção manual de resgate", error);
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
