import { processarRotaApi } from './api_painel.js';
import { processarWebhookTelegram } from './src/telegram.js';
import { renderRankingPage } from './src/pages/ranking.js';

export default {
    async fetch(request, env) {
        const url = new URL(request.url);

        // Webhook do Telegram: roteia mensagens, callbacks e inline queries por handlers dedicados.
        if (url.pathname === "/webhook" && request.method === "POST") {
            return await processarWebhookTelegram(request, env);
        }

        // Ranking visual servido diretamente pelo Cloudflare Worker.
        if ((url.pathname === "/ranking" || url.pathname === "/ranking/") && request.method === "GET") {
            return await renderRankingPage(request, env);
        }

        // Painel Web / APIs.
        if (url.pathname.startsWith("/api")) {
            return await processarRotaApi(request, env);
        }

        return new Response("Bot do Flamengo Ativo na Cloudflare via GitHub!", { status: 200 });
    }
};
