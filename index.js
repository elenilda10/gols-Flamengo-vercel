import { processarRotaApi } from './api_painel.js';
import { processarMensagemTelegram } from './telegram_bot.js';

export default {
    async fetch(request, env) {
        const url = new URL(request.url);

        // Se a requisição vier do Telegram (Mensagens ou Inline Queries)
        if (url.pathname === "/webhook" && request.method === "POST") {
            return await processarMensagemTelegram(request, env);
        }

        // Se a requisição vier do seu Painel Web (Importação do acervo)
        if (url.pathname.startsWith("/api")) {
            return await processarRotaApi(request, env);
        }

        return new Response("Bot do Flamengo Ativo na Cloudflare via GitHub!", { status: 200 });
    }
};
