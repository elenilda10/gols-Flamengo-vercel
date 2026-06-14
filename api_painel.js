// ==========================================================
// 🌐 PROCESSADOR DE APIS DO PAINEL WEB (VERCEL)
// ==========================================================
export async function processarRotaApi(request, env) {
    const url = new URL(request.url);
    const botToken = env.TELEGRAM_TOKEN;

    // Headers CORS fundamentais para que a Vercel consiga ler a Cloudflare sem bloqueios de segurança
    const headersCORS = {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type"
    };

    // Trata a verificação prévia de segurança do navegador (OPTIONS)
    if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: headersCORS });
    }

        // 📊 API 1: /api/ranking_api (VERSÃO TURBO EM PARALELO)
    if (url.pathname === "/api/ranking_api") {
        try {
            let rankingRaw = await env.GOLS_FLAMENGO_KV.get("ranking_global");
            let namesRaw = await env.GOLS_FLAMENGO_KV.get("ranking_names");

            let ranking = rankingRaw ? JSON.parse(rankingRaw) : {};
            let nomes = namesRaw ? JSON.parse(namesRaw) : {};
            const ids = Object.keys(ranking);

            // Mapeia e dispara a busca de dados de TODO MUNDO ao mesmo tempo!
            let rankingArray = await Promise.all(ids.map(async (id) => {
                // Busca acertos e fotos em paralelo para este ID específico
                const [acertosRaw, cachedPhotoRaw] = await Promise.all([
                    env.GOLS_FLAMENGO_KV.get("acertos_" + id),
                    env.GOLS_FLAMENGO_KV.get("profile_photo_" + id)
                ]);

                let acertos = [];
                if (acertosRaw) {
                    try {
                        acertos = JSON.parse(acertosRaw);
                        if (typeof acertos === "string") acertos = [acertos];
                        if (!Array.isArray(acertos)) acertos = [];
                    } catch (e) { acertos = []; }
                }

                let cachedPhoto = cachedPhotoRaw || "";
                
                // Se não tem em cache e o token existe, busca no Telegram (sem travar os outros)
                if (!cachedPhoto && botToken) {
                    try {
                        const responseTelegram = await fetch("https://api.telegram.org/bot" + botToken + "/getUserProfilePhotos", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ user_id: Number(id), limit: 1 }),
                            signal: AbortSignal.timeout(1500) // ⏱️ Trava de segurança: se o Telegram enrolar mais de 1.5s, pula!
                        });
                        const photos = await responseTelegram.json();
                        if (photos && photos.ok && photos.result && photos.result.total_count > 0 && photos.result.photos?.[0]) {
                            let sizes = photos.result.photos[0];
                            let largest = sizes[sizes.length - 1];
                            if (largest && largest.file_id) {
                                cachedPhoto = largest.file_id;
                                await env.GOLS_FLAMENGO_KV.put("profile_photo_" + id, cachedPhoto);
                            }
                        }
                    } catch (e) { cachedPhoto = ""; }
                }

                return {
                    id: String(id),
                    uid: String(id),
                    nome: nomes[id] || "Torcedor",
                    name: nomes[id] || "Torcedor",
                    pontos: Number(ranking[id]) || 0,
                    total: acertos.length,
                    acertos: acertos,
                    photo_file_id: cachedPhoto
                };
            }));

            rankingArray.sort(function (a, b) { return b.pontos - a.pontos; });
            return new Response(JSON.stringify({ ok: true, ranking: rankingArray }), { status: 200, headers: headersCORS });
        } catch (err) {
            return new Response(JSON.stringify({ ok: false, error: err.message }), { status: 500, headers: headersCORS });
        }
    }


    // 👤 API 2: /api/ranking_user_public_api (Perfil Individual de cada torcedor para a Vercel)
    else if (url.pathname === "/api/ranking_user_public_api") {
        try {
            let uid = url.searchParams.get("uid");
            if (!uid) {
                return new Response(JSON.stringify({ ok: false, error: "uid_missing" }), { status: 400, headers: headersCORS });
            }
            uid = String(uid);

            let rankingRaw = await env.GOLS_FLAMENGO_KV.get("ranking_global");
            let namesRaw = await env.GOLS_FLAMENGO_KV.get("ranking_names");
            let acertosRaw = await env.GOLS_FLAMENGO_KV.get("acertos_" + uid);

            let ranking = rankingRaw ? JSON.parse(rankingRaw) : {};
            let nomes = namesRaw ? JSON.parse(namesRaw) : {};
            let acertos = [];
            if (acertosRaw) {
                try {
                    acertos = JSON.parse(acertosRaw);
                    if (typeof acertos === "string") acertos = [acertos];
                } catch(e) { acertos = []; }
            }

            let nome = nomes[uid] || "Usuário";
            let pontos = Number(ranking[uid]) || 0;

            let rankingArray = Object.keys(ranking).map(function(id) {
                return { id: String(id), pontos: Number(ranking[id]) || 0 };
            });
            rankingArray.sort(function(a, b) { return b.pontos - a.pontos; });

            let posicao = 0;
            for (let i = 0; i < rankingArray.length; i++) {
                if (String(rankingArray[i].id) === uid) {
                    posicao = i + 1;
                    break;
                }
            }

            return new Response(JSON.stringify({
                ok: true,
                uid: uid,
                nome: nome,
                pontos: pontos,
                total: acertos.length,
                posicao: posicao,
                acertos: acertos
            }), { status: 200, headers: headersCORS });
        } catch (err) {
            return new Response(JSON.stringify({ ok: false, error: err.message }), { status: 500, headers: headersCORS });
        }
    }

        // ⚽ NOVA API 2.5: /api/addgoal (Para o formulário do site salvar no KV)
    else if (url.pathname === "/api/addgoal" && request.method === "POST") {
        try {
            const body = await request.json();
            
            // Validação simples de segurança pelo ID admin enviado pelo formulário
            if (String(body.admin_id) !== "7717528550") {
                return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), { status: 401, headers: headersCORS });
            }

            const goalId = Date.now();
            
            // Função de normalização idêntica à do robô antigo
            const safeNormalize = (text) => {
                if (!text) return "";
                try { text = text.toLowerCase().trim().normalize("NFD").replace(/[\u0300-\u036f]/g, ""); } catch (e) {}
                return text.replace(/[^\w\s]/g, "").replace(/\s+/g, " ").trim();
            };

            const search = safeNormalize(
                `${body.jogo || ""} ${body.autor || ""} ${body.assistencia || ""} ${body.campeonato || ""} ${body.fase || ""}`
            );

            // Monta o objeto exatamente no formato que o sistema consome
            const goalData = {
                id: goalId,
                jogo: body.jogo.trim(),
                autor: body.autor.trim(),
                assistencia: body.assistencia.trim(),
                campeonato: body.campeonato.trim(),
                fase: body.fase.trim(),
                file_id: body.file_id.trim(),
                views: 0,
                created_at: Date.now(),
                search: search,
                admin_id: Number(body.admin_id)
            };

            // 1. Salva o gol individual
            await env.GOLS_FLAMENGO_KV.put(`gol_${goalId}`, JSON.stringify(goalData));

            // 2. Atualiza o índice global de gols
            let indexRaw = await env.GOLS_FLAMENGO_KV.get("gols_index");
            let index = indexRaw ? JSON.parse(indexRaw) : [];
            
            if (!index.includes(Number(goalId)) && !index.includes(String(goalId))) {
                index.push(goalId);
            }
            await env.GOLS_FLAMENGO_KV.put("gols_index", JSON.stringify(index));

            // 3. Envia uma cópia em segundo plano para o seu Canal de Backup do Telegram automaticamente!
            try {
                const CANAL_BACKUP = "-1003703318973";
                await fetch(`https://api.telegram.org/bot${botToken}/sendVideo`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        chat_id: CANAL_BACKUP,
                        video: goalData.file_id,
                        caption: `📌 <b>Novo gol adicionado via Painel Web</b>\n\n🆔 <code>${goalData.id}</code>\n⚽ ${goalData.jogo}\n\n👟 Autor: ${goalData.autor}\n🅰 Assistência: ${goalData.assistencia}\n🏆 ${goalData.campeonato} - ${goalData.fase}`,
                        parse_mode: "HTML"
                    })
                });
            } catch (eTelegram) { console.error("Erro envio canal:", eTelegram.message); }

            return new Response(JSON.stringify({ ok: true, id: goalId }), { status: 200, headers: headersCORS });
        } catch (err) {
            return new Response(JSON.stringify({ ok: false, error: err.message }), { status: 500, headers: headersCORS });
        }
    }

    // 🔄 ROTA 3: Rota de Migração do Acervo Antigo (Mantida Intacta)
    else if (url.pathname === "/api/importar-tudo" && request.method === "POST") {
        try {
            const acervo = await request.json();
            let novosIds = [];

            for (const gol of acervo) {
                if (gol && gol.id) {
                    await env.GOLS_FLAMENGO_KV.put(`gol_${gol.id}`, JSON.stringify(gol));
                    novosIds.push(String(gol.id));
                }
            } 

            await env.GOLS_FLAMENGO_KV.put("gols_index", JSON.stringify(novosIds));

            return new Response(JSON.stringify({ status: "sucesso", gols_importados: acervo.length }), {
                status: 200, headers: headersCORS
            });
        } catch (erro) {
            return new Response(JSON.stringify({ status: "erro", detalhe: erro.message }), {
                status: 500, headers: headersCORS
            });
        }
    }

    // Retorno padrão caso tentem acessar qualquer link bizarro que não exista
    return new Response(JSON.stringify({ erro: "Rota não encontrada" }), { status: 404, headers: headersCORS });
}
