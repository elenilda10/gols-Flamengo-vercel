import { processarRotaApi } from './api_painel.js';
import { processarWebhookTelegram } from './src/telegram.js';
import { renderRankingAvatar } from './src/pages/ranking.js';
import { renderHomePage, renderUserPage, renderAdminPage, processarSiteApi } from './src/pages/site.js';

export default {
    async fetch(request, env) {
        const url = new URL(request.url);

        if (url.pathname === "/webhook" && request.method === "POST") {
            return await processarWebhookTelegram(request, env);
        }

        if ((url.pathname === "/" || url.pathname === "/ranking" || url.pathname === "/ranking/") && request.method === "GET") {
            return await renderHomePage(request, env);
        }

        if (/^\/user\/\d+\/?$/.test(url.pathname) && request.method === "GET") {
            return await renderUserPage(request, env);
        }

        if ((url.pathname === "/admin" || url.pathname === "/admin/") && request.method === "GET") {
            return await renderAdminPage(request, env);
        }

        if (url.pathname.startsWith("/ranking/avatar/") && request.method === "GET") {
            return await renderRankingAvatar(request, env);
        }

        if (url.pathname.startsWith("/api")) {
            const siteResponse = await processarSiteApi(request, env);
            if (siteResponse) return siteResponse;
            return await processarRotaApi(request, env);
        }

        return new Response("Not found", { status: 404 });
    }
};
