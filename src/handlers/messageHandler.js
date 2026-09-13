import { encaminharParaMotorAtual } from "./legacyAdapter.js";
import { processarResgatePontos } from "../services/redemption.js";
import { processarPalpiteAutomatico } from "../services/bets.js";
import { processarCorrecaoResgate } from "../services/redemptionAdmin.js";
import { processarBolaoTeste } from "../services/testBolao.js";

export async function handleMessage(update, env) {
    if (!update?.message) {
        return new Response("OK", { status: 200 });
    }

    const message = update.message;
    console.log("[MESSAGE_HANDLER] entrada", {
        update_id: update?.update_id ?? null,
        chat_id: message?.chat?.id ?? null,
        chat_type: message?.chat?.type ?? null,
        message_id: message?.message_id ?? null,
        reply_to_message_id: message?.reply_to_message?.message_id ?? null,
        reply_forward_chat_id: message?.reply_to_message?.forward_from_chat?.id ?? null,
        reply_is_automatic_forward: message?.reply_to_message?.is_automatic_forward ?? null,
        texto: String(message?.text || message?.caption || "").slice(0, 120)
    });

    try {
        console.log("[BOLAO_TESTE] iniciando processamento", {
            update_id: update?.update_id ?? null,
            message_id: message?.message_id ?? null
        });

        const processadoComoTeste = await processarBolaoTeste(update, env);

        console.log("[BOLAO_TESTE] processamento concluído", {
            update_id: update?.update_id ?? null,
            message_id: message?.message_id ?? null,
            processado: Boolean(processadoComoTeste)
        });

        if (processadoComoTeste) {
            return new Response("OK", { status: 200 });
        }
    } catch (error) {
        console.error("[BOLAO_TESTE] erro", {
            update_id: update?.update_id ?? null,
            message_id: message?.message_id ?? null,
            erro: String(error?.message || error),
            stack: String(error?.stack || "").slice(0, 1000)
        });
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
