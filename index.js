import { processarRotaApi } from './api_painel.js';
import { processarWebhookTelegram } from './src/telegram.js';
import { renderRankingAvatar } from './src/pages/ranking.js';
import { renderHomePage, renderUserPage, renderAdminPage, processarSiteApi } from './src/pages/site.js';
import { processarCompatApi, renderWorkerFavicon } from './src/pages/compat.js';
import { processarGolsApi } from './src/painel/goalsApi.js';

export default {
    async fetch(request, env) {
        const url = new URL(request.url);

        if (url.pathname === "/webhook" && request.method === "POST") {
            return await processarWebhookTelegram(request, env);
        }

        if ((url.pathname === "/favicon.svg" || url.pathname === "/favicon.ico" || url.pathname === "/favicon.png") && request.method === "GET") {
            return renderWorkerFavicon();
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
            const compatResponse = await processarCompatApi(request, env);
            if (compatResponse) return compatResponse;

            const siteResponse = await processarSiteApi(request, env);
            if (siteResponse) return siteResponse;

            const goalsResponse = await processarGolsApi(request, env);
            if (goalsResponse) return goalsResponse;

            return await processarRotaApi(request, env);
        }

        return new Response("Not found", { status: 404 });
    }
};
