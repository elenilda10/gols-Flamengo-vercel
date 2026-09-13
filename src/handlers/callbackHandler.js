import { encaminharParaMotorAtual } from "./legacyAdapter.js";
import { processarCallbackGanhou } from "../services/winnerAdmin.js";
import { processarCallbackGanhouTeste } from "../services/testWinnerAdmin.js";
import { processarMenuPrincipal } from "../services/mainMenu.js";

export async function handleCallback(update, env) {
    if (!update?.callback_query) {
        return new Response("OK", { status: 200 });
    }

    const processadoComoTeste = await processarCallbackGanhouTeste(update, env);
    if (processadoComoTeste) {
        return new Response("OK", { status: 200 });
    }

    const processadoComoGanhou = await processarCallbackGanhou(update, env);
    if (processadoComoGanhou) {
        return new Response("OK", { status: 200 });
    }

    const processadoComoMenu = await processarMenuPrincipal(update, env);
    if (processadoComoMenu) {
        return new Response("OK", { status: 200 });
    }

    return encaminharParaMotorAtual(update, env);
}
