// ==========================================================
// 🌐 PROCESSADOR DE APIS E PAINEL WEB DIRECT DEPLOY (CLOUDFLARE)
// ==========================================================
export async function processarRotaApi(request, env) {
    const url = new URL(request.url);
    const botToken = env.TELEGRAM_TOKEN;

    const headersCORS = {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type"
    };

    if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: headersCORS });
    }

    // 📊 API 1: /api/ranking_api (Tabela Completa em Paralelo)
    if (url.pathname === "/api/ranking_api") {
        try {
            let rankingRaw = await env.GOLS_FLAMENGO_KV.get("ranking_global");
            let namesRaw = await env.GOLS_FLAMENGO_KV.get("ranking_names");

            let ranking = rankingRaw ? JSON.parse(rankingRaw) : {};
            let nomes = namesRaw ? JSON.parse(namesRaw) : {};
            const ids = Object.keys(ranking);

            let rankingArray = await Promise.all(ids.map(async (id) => {
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
                if (!cachedPhoto && botToken) {
                    try {
                        const responseTelegram = await fetch("https://api.telegram.org/bot" + botToken + "/getUserProfilePhotos", {
                            method: "POST", headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ user_id: Number(id), limit: 1 }),
                            signal: AbortSignal.timeout(1500)
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

    // 👤 API 2: /api/ranking_user_public_api (Perfil Individual)
    else if (url.pathname === "/api/ranking_user_public_api") {
        try {
            let uid = url.searchParams.get("uid");
            if (!uid) return new Response(JSON.stringify({ ok: false, error: "uid_missing" }), { status: 400, headers: headersCORS });
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

            return new Response(JSON.stringify({ ok: true, uid: uid, nome: nome, pontos: pontos, total: acertos.length, posicao: posicao, acertos: acertos }), { status: 200, headers: headersCORS });
        } catch (err) {
            return new Response(JSON.stringify({ ok: false, error: err.message }), { status: 500, headers: headersCORS });
        }
    }

    // 🖥️ NOVO PAINEL VISUAL: /api/painel-addgoal (Renderiza a tela do formulário direto no navegador)
    else if (url.pathname === "/api/painel-addgoal" && request.method === "GET") {
        const htmlForm = `
        <!DOCTYPE html>
        <html lang="pt-BR">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>⚽ Cloudflare Painel - AddGoal</title>
            <style>
                body { background-color: #09090b; color: #fff; font-family: -apple-system, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px; box-sizing: border-box; }
                .card { width: 100%; maxWidth: 550px; background: #18181b; border-radius: 20px; padding: 30px; box-shadow: 0 20px 40px rgba(0,0,0,0.5); border: 1px solid rgba(255,255,255,0.08); box-sizing: border-box; }
                h1 { margin: 0 0 5px 0; font-size: 26px; font-weight: 800; }
                p { color: #a1a1aa; margin: 0 0 22px 0; font-size: 14px; }
                .alert { padding: 12px; border-radius: 10px; margin-bottom: 18px; font-size: 14px; font-weight: 600; display: none; border: 1px solid rgba(255,255,255,0.1); }
                form { display: flex; flex-direction: column; gap: 15px; }
                .row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
                .field { display: flex; flex-direction: column; gap: 5px; }
                label { font-size: 12px; font-weight: 600; color: #d4d4d8; }
                input { background: #09090b; border: "1px solid rgba(255,255,255,0.1)"; border: 1px solid rgba(255,255,255,0.15); border-radius: 10px; padding: 12px; color: #fff; font-size: 14px; outline: none; }
                button { background: linear-gradient(135deg, #ef4444, #b91c1c); color: #fff; border: 0; border-radius: 12px; padding: 14px; font-size: 15px; font-weight: 700; cursor: pointer; margin-top: 5px; box-shadow: 0 8px 12px rgba(239, 68, 68, 0.2); }
                button:disabled { opacity: 0.6; cursor: not-allowed; }
            </style>
        </head>
        <body>
            <div class="card">
                <h1>⚽ Adicionar Novo Gol</h1>
                <p>Gerenciamento direto no Banco KV da Cloudflare.</p>
                
                <div id="alertBox" class="alert"></div>

                <form id="goalForm">
                    <div class="field">
                        <label>Confronto / Jogo</label>
                        <input type="text" id="jogo" required placeholder="Ex: Flamengo 2x1 Vasco">
                    </div>
                    <div class="row">
                        <div class="field">
                            <label>Autor do Gol</label>
                            <input type="text" id="autor" required placeholder="Ex: Pedro">
                        </div>
                        <div class="field">
                            <label>Assistência</label>
                            <input type="text" id="assistencia" required placeholder="Ex: Arrascaeta (ou Ninguém)">
                        </div>
                    </div>
                    <div class="row">
                        <div class="field">
                            <label>Campeonato</label>
                            <input type="text" id="campeonato" required placeholder="Ex: Brasileirão">
                        </div>
                        <div class="field">
                            <label>Fase / Rodada</label>
                            <input type="text" id="fase" required placeholder="Ex: 14ª Rodada">
                        </div>
                    </div>
                    <div class="field">
                        <label>Telegram FileID do Vídeo</label>
                        <input type="text" id="file_id" required placeholder="Cole o file_id longo do vídeo">
                    </div>
                    <div class="field">
                        <label>ID Administrador (Segurança)</label>
                        <input type="password" id="admin_id" value="7717528550" required>
                    </div>
                    <button type="submit" id="btnSubmit">🚀 Salvar e Cadastrar Gol</button>
                </form>
            </div>

            <script>
                document.getElementById('goalForm').addEventListener('submit', async (e) => {
                    e.preventDefault();
                    const btn = document.getElementById('btnSubmit');
                    const alertBox = document.getElementById('alertBox');
                    
                    btn.disabled = true;
                    btn.innerText = 'Processando...';
                    alertBox.style.display = 'none';

                    const payload = {
                        jogo: document.getElementById('jogo').value,
                        autor: document.getElementById('autor').value,
                        assistencia: document.getElementById('assistencia').value,
                        campeonato: document.getElementById('campeonato').value,
                        fase: document.getElementById('fase').value,
                        file_id: document.getElementById('file_id').value,
                        admin_id: document.getElementById('admin_id').value
                    };

                    try {
                        const res = await fetch('/api/addgoal-action', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(payload)
                        });
                        const data = await res.json();

                        if (data.ok) {
                            alertBox.style.backgroundColor = '#065f46';
                            alertBox.innerText = '✅ Sucesso! Gol salvo de forma permanente com o ID: ' + data.id;
                            document.getElementById('jogo').value = '';
                            document.getElementById('autor').value = '';
                            document.getElementById('assistencia').value = '';
                            document.getElementById('file_id').value = '';
                        } else {
                            alertBox.style.backgroundColor = '#991b1b';
                            alertBox.innerText = '❌ Erro: ' + (data.error || 'Falha ao salvar');
                        }
                    } catch (err) {
                        alertBox.style.backgroundColor = '#991b1b';
                        alertBox.innerText = '❌ Erro crítico de conexão com a API.';
                    } finally {
                        alertBox.style.display = 'block';
                        btn.disabled = false;
                        btn.innerText = '🚀 Salvar e Cadastrar Gol';
                    }
                });
            </script>
        </body>
        </html>
        `;
        return new Response(htmlForm, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
    }

    // ⚡ AÇÃO DA API: /api/addgoal-action (Processa o clique de salvar do formulário)
    else if (url.pathname === "/api/addgoal-action" && request.method === "POST") {
        try {
            const body = await request.json();
            
            if (String(body.admin_id) !== "7717528550") {
                return new Response(JSON.stringify({ ok: false, error: "Acesso Negado: ID Inválido." }), { status: 401, headers: headersCORS });
            }

            const goalId = Date.now();
            
            const safeNormalize = (text) => {
                if (!text) return "";
                try { text = text.toLowerCase().trim().normalize("NFD").replace(/[\u0300-\u036f]/g, ""); } catch (e) {}
                return text.replace(/[^\w\s]/g, "").replace(/\s+/g, " ").trim();
            };

            const search = safeNormalize(
                `${body.jogo || ""} ${body.autor || ""} ${body.assistencia || ""} ${body.campeonato || ""} ${body.fase || ""}`
            );

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

            // 1. Salva no banco KV
            await env.GOLS_FLAMENGO_KV.put(`gol_${goalId}`, JSON.stringify(goalData));

            // 2. Registra no índice de buscas
            let indexRaw = await env.GOLS_FLAMENGO_KV.get("gols_index");
            let index = indexRaw ? JSON.parse(indexRaw) : [];
            if (!index.includes(Number(goalId)) && !index.includes(String(goalId))) {
                index.push(goalId);
            }
            await env.GOLS_FLAMENGO_KV.put("gols_index", JSON.stringify(index));

            // 3. Envia automático para o Canal de Backup
            try {
                const CANAL_BACKUP = "-1003703318973";
                await fetch(`https://api.telegram.org/bot${botToken}/sendVideo`, {
                    method: "POST", headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        chat_id: CANAL_BACKUP, video: goalData.file_id,
                        caption: `📌 <b>Novo gol adicionado via Painel Cloudflare</b>\n\n🆔 <code>${goalData.id}</code>\n⚽ ${goalData.jogo}\n\n👟 Autor: ${goalData.autor}\n🅰 Assistência: ${goalData.assistencia}\n🏆 ${goalData.campeonato} - ${goalData.fase}`,
                        parse_mode: "HTML"
                    })
                });
            } catch (e) {}

            return new Response(JSON.stringify({ ok: true, id: goalId }), { status: 200, headers: headersCORS });
        } catch (err) {
            return new Response(JSON.stringify({ ok: false, error: err.message }), { status: 500, headers: headersCORS });
        }
    }

    // 🔄 ROTA 4: /api/importar-tudo (Migração antiga)
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
            return new Response(JSON.stringify({ status: "sucesso", gols_importados: acervo.length }), { status: 200, headers: headersCORS });
        } catch (erro) {
            return new Response(JSON.stringify({ status: "erro", detalhe: erro.message }), { status: 500, headers: headersCORS });
        }
    }

    return new Response(JSON.stringify({ erro: "Rota não encontrada" }), { status: 404, headers: headersCORS });
}
