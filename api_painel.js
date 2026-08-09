// ==========================================================
// 🌐 PROCESSADOR DE APIS, GERENCIADOR WEB E MOTOR DE BOLÃO (CLOUDFLARE)
// ==========================================================
export async function processarRotaApi(request, env) {
    const url = new URL(request.url);
    const botToken = env.TELEGRAM_TOKEN;

    const headersCORS = {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS, DELETE",
        "Access-Control-Allow-Headers": "Content-Type"
    };

    if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: headersCORS });
    }

    // 📊 API 1: /api/ranking_api (Tabela Completa com Fotos e Nomes)
    if (url.pathname === "/api/ranking_api") {
        try {
            let rankingRaw = await env.GOLS_FLAMENGO_KV.get("ranking_global");
            let namesRaw = await env.GOLS_FLAMENGO_KV.get("ranking_names");

            let ranking = rankingRaw ? JSON.parse(rankingRaw) : {};
            let nomes = namesRaw ? JSON.parse(namesRaw) : {};
            const ids = Object.keys(ranking);

            let rankingArray = await Promise.all(ids.map(async (id) => {
                const [acertosRaw, cachedPhotoUrl] = await Promise.all([
                    env.GOLS_FLAMENGO_KV.get("acertos_" + id),
                    env.GOLS_FLAMENGO_KV.get("profile_photo_url_" + id)
                ]);

                let acertos = [];
                if (acertosRaw) {
                    try {
                        acertos = JSON.parse(acertosRaw);
                        if (typeof acertos === "string") acertos = [acertos];
                        if (!Array.isArray(acertos)) acertos = [];
                    } catch (e) { acertos = []; }
                }

                let finalPhotoUrl = cachedPhotoUrl || "";

                // Tenta buscar a foto real no Telegram caso não esteja no cache
                if (!finalPhotoUrl && botToken) {
                    try {
                        const photosRes = await fetch(`https://api.telegram.org/bot${botToken}/getUserProfilePhotos?user_id=${id}&limit=1`);
                        const photosData = await photosRes.json();

                        if (photosData.ok && photosData.result?.photos?.length > 0) {
                            const fileId = photosData.result.photos[0][0].file_id;
                            const fileRes = await fetch(`https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`);
                            const fileData = await fileRes.json();

                            if (fileData.ok && fileData.result?.file_path) {
                                finalPhotoUrl = `https://api.telegram.org/file/bot${botToken}/${fileData.result.file_path}`;
                                await env.GOLS_FLAMENGO_KV.put("profile_photo_url_" + id, finalPhotoUrl, { expirationTtl: 86400 });
                            }
                        }
                    } catch (e) {}
                }

                // Fallback dinâmico com iniciais no estilo Rubro-Negro caso o usuário não tenha foto pública no Telegram
                if (!finalPhotoUrl) {
                    const nomeUser = nomes[id] || "Torcedor";
                    finalPhotoUrl = `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(nomeUser)}&backgroundColor=dc2626&textColor=ffffff&bold=true`;
                }

                return {
                    id: String(id),
                    uid: String(id),
                    nome: nomes[id] || "Torcedor",
                    name: nomes[id] || "Torcedor",
                    pontos: Number(ranking[id]) || 0,
                    total: acertos.length,
                    acertos: acertos,
                    photo_url: finalPhotoUrl,
                    photo_file_id: finalPhotoUrl
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

            let ranking = rankingRaw ? JSON.parse(rankingRaw) : {};
            let nomes = namesRaw ? JSON.parse(namesRaw) : {};

            let nome = nomes[uid] || "Usuário";
            let pontos = Number(ranking[uid]) || 0;

            let rankingArray = Object.keys(ranking).map(function(id) {
                return { id: String(id), pontos: Number(ranking[id]) || 0 };
            });
            rankingArray.sort(function(a, b) { return b.pontos - a.pontos; });

            let posicao = rankingArray.findIndex(x => String(x.id) === uid) + 1;

            return new Response(JSON.stringify({ ok: true, uid: uid, nome: nome, pontos: pontos, posicao: posicao }), { status: 200, headers: headersCORS });
        } catch (err) {
            return new Response(JSON.stringify({ ok: false, error: err.message }), { status: 500, headers: headersCORS });
        }
    }

    // 🖥️ PAINEL VISUAL: /api/painel-addgoal
    else if (url.pathname === "/api/painel-addgoal" && request.method === "GET") {
        const htmlForm = `
        <!DOCTYPE html>
        <html lang="pt-BR">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>⚽ Painel de Controle - Gols do Flamengo</title>
            <link rel="preconnect" href="https://fonts.googleapis.com">
            <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
            <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@500;700&display=swap" rel="stylesheet">
            <style>
                :root {
                    --bg-main: #0b0d10;
                    --card-bg: rgba(22, 26, 33, 0.85);
                    --border-color: rgba(255, 255, 255, 0.08);
                    --accent-red: #dc2626;
                    --accent-red-glow: rgba(220, 38, 38, 0.35);
                    --text-primary: #f8fafc;
                    --text-muted: #94a3b8;
                    --font-main: 'Plus Jakarta Sans', -apple-system, sans-serif;
                    --font-code: 'JetBrains Mono', monospace;
                }

                body { 
                    background-color: var(--bg-main); 
                    background-image: 
                        radial-gradient(at 10% 20%, rgba(220, 38, 38, 0.12) 0px, transparent 50%),
                        radial-gradient(at 90% 80%, rgba(185, 28, 28, 0.08) 0px, transparent 50%);
                    background-attachment: fixed;
                    color: var(--text-primary); 
                    font-family: var(--font-main); 
                    display: flex; 
                    align-items: center; 
                    justify-content: center; 
                    min-height: 100vh; 
                    margin: 0; 
                    padding: 20px 15px; 
                    box-sizing: border-box; 
                    -webkit-font-smoothing: antialiased;
                }

                .card { 
                    width: 100%; 
                    max-width: 580px; 
                    background: var(--card-bg); 
                    backdrop-filter: blur(16px);
                    -webkit-backdrop-filter: blur(16px);
                    border-radius: 24px; 
                    padding: 30px; 
                    box-shadow: 0 30px 60px rgba(0, 0, 0, 0.6), inset 0 1px 0 rgba(255, 255, 255, 0.1); 
                    border: 1px solid var(--border-color); 
                    box-sizing: border-box; 
                }

                h1 { 
                    margin: 0 0 6px 0; 
                    font-size: 26px; 
                    font-weight: 800; 
                    letter-spacing: -0.03em;
                    background: linear-gradient(135deg, #ffffff 30%, #94a3b8 100%);
                    -webkit-background-clip: text;
                    -webkit-text-fill-color: transparent;
                }

                p { color: var(--text-muted); margin: 0 0 20px 0; font-size: 14px; font-weight: 500; }

                .nav-link { 
                    display: inline-flex; 
                    align-items: center;
                    gap: 6px;
                    color: #f87171; 
                    font-size: 13px; 
                    font-weight: 700; 
                    text-decoration: none; 
                    margin-bottom: 24px; 
                    padding: 8px 14px;
                    background: rgba(220, 38, 38, 0.1);
                    border: 1px solid rgba(220, 38, 38, 0.2);
                    border-radius: 12px;
                    transition: all 0.2s ease;
                }
                .nav-link:hover {
                    background: rgba(220, 38, 38, 0.2);
                    transform: translateY(-1px);
                }

                .alert { padding: 14px; border-radius: 12px; margin-bottom: 20px; font-size: 14px; font-weight: 600; display: none; border: 1px solid rgba(255,255,255,0.1); word-break: break-all; }

                form { display: flex; flex-direction: column; gap: 16px; }
                .row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
                
                .search-row { 
                    display: grid; 
                    grid-template-columns: 1fr auto; 
                    gap: 12px; 
                    align-items: flex-end; 
                    background: rgba(255,255,255,0.02); 
                    padding: 14px; 
                    border-radius: 14px; 
                    border: 1px dashed rgba(255,255,255,0.1); 
                    margin-bottom: 10px; 
                }

                .field { display: flex; flex-direction: column; gap: 6px; }
                label { font-size: 12px; font-weight: 700; color: #cbd5e1; text-transform: uppercase; letter-spacing: 0.05em; }

                input { 
                    background: rgba(11, 13, 16, 0.8); 
                    border: 1px solid var(--border-color); 
                    border-radius: 12px; 
                    padding: 14px 16px; 
                    color: #fff; 
                    font-size: 14px; 
                    font-family: var(--font-main); 
                    outline: none; 
                    width: 100%; 
                    box-sizing: border-box; 
                    transition: all 0.2s ease;
                }
                input:focus { 
                    border-color: var(--accent-red); 
                    box-shadow: 0 0 0 3px var(--accent-red-glow); 
                    background: rgba(11, 13, 16, 0.95);
                }

                code { font-family: var(--font-code); }

                .btn-primary { 
                    background: linear-gradient(135deg, #ef4444, #991b1b); 
                    color: #fff; 
                    border: 0; 
                    border-radius: 14px; 
                    padding: 16px; 
                    font-size: 15px; 
                    font-family: var(--font-main); 
                    font-weight: 700; 
                    cursor: pointer; 
                    margin-top: 10px; 
                    box-shadow: 0 10px 20px var(--accent-red-glow); 
                    width: 100%; 
                    transition: all 0.2s ease;
                }
                .btn-primary:hover {
                    transform: translateY(-2px);
                    box-shadow: 0 14px 28px var(--accent-red-glow);
                }

                .btn-secondary { 
                    background: #1e293b; 
                    color: #f1f5f9; 
                    border: 1px solid var(--border-color); 
                    border-radius: 12px; 
                    padding: 13px 18px; 
                    font-size: 14px; 
                    font-family: var(--font-main); 
                    font-weight: 700; 
                    cursor: pointer; 
                    transition: all 0.2s ease;
                    height: 48px;
                    box-sizing: border-box;
                }
                .btn-secondary:hover { background: #334155; }

                .modal-overlay { position: fixed; top:0; left:0; width:100%; height:100%; background: rgba(0,0,0,0.8); backdrop-filter: blur(8px); display:flex; align-items:center; justify-content:center; padding:15px; box-sizing:border-box; z-index:1000; opacity:0; pointer-events:none; transition: opacity 0.2s ease; }
                .modal-overlay.active { opacity:1; pointer-events:auto; }
                .modal-content { background:#161a21; border: 1px solid rgba(255,255,255,0.12); border-radius:20px; width:100%; max-width:480px; padding:24px; box-sizing:border-box; box-shadow: 0 25px 50px rgba(0,0,0,0.6); }
                .modal-title { margin:0 0 10px 0; font-size:20px; font-weight:800; display:flex; align-items:center; gap:8px; }
                .modal-body { font-size:14px; color:#e4e4e7; line-height:1.6; background:#0b0d10; padding:14px; border-radius:12px; border:1px solid rgba(255,255,255,0.06); margin-bottom:18px; max-height:260px; overflow-y:auto; }
                .modal-buttons { display:flex; justify-content:flex-end; gap:10px; }
                .btn-modal-confirm { background:#065f46; color:#fff; border:0; padding:12px 20px; font-weight:700; font-family: var(--font-main); border-radius:10px; cursor:pointer; font-size:14px; }
                .btn-modal-cancel { background:#1e293b; color:#fff; border:1px solid rgba(255,255,255,0.08); padding:12px 20px; font-weight:700; font-family: var(--font-main); border-radius:10px; cursor:pointer; font-size:14px; }
                
                @media (max-width: 600px) {
                    body { padding: 12px; }
                    .card { padding: 22px; border-radius: 20px; }
                    h1 { font-size: 22px; }
                    .row { grid-template-columns: 1fr; gap: 15px; }
                }
            </style>
        </head>
        <body>
            <div class="card">
                <h1 id="panelTitle">⚽ Adicionar Novo Gol</h1>
                <p id="panelSubtitle">Preencha os campos abaixo para injetar no Banco KV.</p>
                
                <a href="/api/lista-gols" class="nav-link">📋 Ver Lista Completa de Gols</a>
                
                <div id="alertBox" class="alert"></div>

                <div class="search-row">
                    <div class="field">
                        <label>ID do Gol (Opcional para edição)</label>
                        <input type="text" id="goal_id" placeholder="Ex: 1718362402941">
                    </div>
                    <button type="button" id="btnSearch" class="btn-secondary" onclick="buscarGol()">🔍 Buscar</button>
                </div>

                <form id="goalForm" onsubmit="abrirModalConfirmacao(event)">
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
                            <input type="text" id="assistencia" required placeholder="Ex: Arrascaeta">
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
                    <button type="submit" id="btnSubmit" class="btn-primary">🚀 Confirmar e Salvar Gol</button>
                </form>
            </div>

            <div id="confirmModal" class="modal-overlay">
                <div class="modal-content">
                    <h3 class="modal-title">⚠️ Confirmar Registro?</h3>
                    <p style="font-size:13px; color:#a1a1aa; margin:0 0 12px 0;">Confira os dados antes de gravar de forma definitiva:</p>
                    <div id="modalDataPreview" class="modal-body"></div>
                    <div class="modal-buttons">
                        <button class="btn-modal-cancel" onclick="fecharModal()">🔙 Voltar</button>
                        <button class="btn-modal-confirm" onclick="executarEnvioDefinitivo()">✅ Confirmar e Salvar</button>
                    </div>
                </div>
            </div>

            <script>
                const goalIdInput = document.getElementById('goal_id');
                const panelTitle = document.getElementById('panelTitle');
                const panelSubtitle = document.getElementById('panelSubtitle');
                const btnSubmit = document.getElementById('btnSubmit');
                const confirmModal = document.getElementById('confirmModal');
                const modalDataPreview = document.getElementById('modalDataPreview');

                const urlParams = new URLSearchParams(window.location.search);
                const editId = urlParams.get('edit_id');
                if (editId) {
                    goalIdInput.value = editId;
                    goalIdInput.dispatchEvent(new Event('input'));
                    buscarGol();
                }

                goalIdInput.addEventListener('input', () => {
                    if(goalIdInput.value.trim() !== "") {
                        panelTitle.innerText = "📝 Editar Gol Existente";
                        panelSubtitle.innerText = "Modificando dados do registro ID: " + goalIdInput.value.trim();
                        btnSubmit.innerText = "💾 Salvar Alterações no Gol";
                    } else {
                        panelTitle.innerText = "⚽ Adicionar Novo Gol";
                        panelSubtitle.innerText = "Preencha os campos abaixo para injetar no Banco KV.";
                        btnSubmit.innerText = "🚀 Confirmar e Salvar Gol";
                    }
                });

                async function buscarGol() {
                    const id = goalIdInput.value.trim();
                    const alertBox = document.getElementById('alertBox');
                    if (!id) {
                        alertBox.style.backgroundColor = '#991b1b';
                        alertBox.innerText = '⚠️ Digite um ID de gol válido para buscar.';
                        alertBox.style.display = 'block';
                        return;
                    }

                    alertBox.style.display = 'none';
                    try {
                        const res = await fetch('/api/getgoal?id=' + id);
                        const data = await res.json();
                        if (data.ok) {
                            document.getElementById('jogo').value = data.gol.jogo || '';
                            document.getElementById('autor').value = data.gol.autor || '';
                            document.getElementById('assistencia').value = data.gol.assistencia || '';
                            document.getElementById('campeonato').value = data.gol.campeonato || '';
                            document.getElementById('fase').value = data.gol.fase || '';
                            document.getElementById('file_id').value = data.gol.file_id || '';
                            
                            alertBox.style.backgroundColor = '#1e3a8a';
                            alertBox.innerText = '🔍 Dados carregados! Altere os campos abaixo e clique em Salvar.';
                            alertBox.style.display = 'block';
                        } else {
                            alertBox.style.backgroundColor = '#991b1b';
                            alertBox.innerText = '❌ Erro: ' + (data.error || 'Gol não encontrado');
                            alertBox.style.display = 'block';
                        }
                    } catch (e) {
                        alertBox.style.backgroundColor = '#991b1b';
                        alertBox.innerText = '❌ Falha ao buscar dados no servidor.';
                        alertBox.style.display = 'block';
                    }
                }

                function abrirModalConfirmacao(e) {
                    e.preventDefault();
                    const idText = goalIdInput.value.trim() || '<i>Gerado automaticamente (Novo Gol)</i>';
                    const jogo = document.getElementById('jogo').value;
                    const autor = document.getElementById('autor').value;
                    const assistencia = document.getElementById('assistencia').value;
                    const campeonato = document.getElementById('campeonato').value;
                    const fase = document.getElementById('fase').value;
                    const file_id = document.getElementById('file_id').value;

                    modalDataPreview.innerHTML = 
                        '<strong>🆔 ID:</strong> ' + idText + '<br>' +
                        '<strong>⚽ Jogo:</strong> ' + jogo + '<br>' +
                        '<strong>👤 Autor:</strong> ' + autor + '<br>' +
                        '<strong>🅰️ Assistência:</strong> ' + assistencia + '<br>' +
                        '<strong>🏆 Campeonato:</strong> ' + campeonato + '<br>' +
                        '<strong>📍 Fase/Rodada:</strong> ' + fase + '<br>' +
                        '<strong style="display:block; margin-top:6px; margin-bottom:2px;">📂 FileID:</strong>' +
                        '<span style="font-size:11px; color:#f87171; font-family:var(--font-code); word-break:break-all;">' + file_id + '</span>';
                    
                    confirmModal.classList.add('active');
                }

                function fecharModal() {
                    confirmModal.classList.remove('active');
                }

                async function executarEnvioDefinitivo() {
                    fecharModal();
                    const alertBox = document.getElementById('alertBox');
                    btnSubmit.disabled = true;
                    alertBox.style.display = 'none';

                    const payload = {
                        id: goalIdInput.value.trim(),
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
                            alertBox.innerText = '✅ Processado com sucesso! Registro salvo no KV com o ID: ' + data.id;
                            goalIdInput.value = '';
                            document.getElementById('goalForm').reset();
                            document.getElementById('admin_id').value = '7717528550';
                            panelTitle.innerText = "⚽ Adicionar Novo Gol";
                            btnSubmit.innerText = "🚀 Confirmar e Salvar Gol";
                        } else {
                            alertBox.style.backgroundColor = '#991b1b';
                            alertBox.innerText = '❌ Erro no processamento: ' + (data.error || 'Falha ao salvar');
                        }
                    } catch (err) {
                        alertBox.style.backgroundColor = '#991b1b';
                        alertBox.innerText = '❌ Erro crítico de comunicação.';
                    } finally {
                        alertBox.style.display = 'block';
                        btnSubmit.disabled = false;
                    }
                }
            </script>
        </body>
        </html>
        `;
        return new Response(htmlForm, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
    }

    // 📋 LISTA DE GOLS INTELIGENTE: /api/lista-gols
    else if (url.pathname === "/api/lista-gols" && request.method === "GET") {
        try {
            let queryText = url.searchParams.get("q") || "";
            queryText = queryText.toLowerCase().trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\w\s]/g, "");

            let index = [];
            let cursor = "";
            while (true) {
                let listaBruta = await env.GOLS_FLAMENGO_KV.list({ prefix: "gol_", limit: 1000, cursor: cursor });
                index.push(...listaBruta.keys.map(k => k.name.replace("gol_", "")));
                if (listaBruta.list_complete || !listaBruta.cursor) break;
                cursor = listaBruta.cursor;
            }
            index = [...new Set(index)];

            let loteDadosRaw = await Promise.all(index.map(id => env.GOLS_FLAMENGO_KV.get(`gol_${id}`)));
            let gols = [];

            for (let i = 0; i < loteDadosRaw.length; i++) {
                if (loteDadosRaw[i]) {
                    try {
                        let golObj = JSON.parse(loteDadosRaw[i]);
                        if (queryText) {
                            const termos = queryText.split(" ").filter(Boolean);
                            const targetText = (golObj.search || "").toLowerCase();
                            const match = termos.every(term => targetText.includes(term));
                            if (match) gols.push(golObj);
                        } else {
                            gols.push(golObj);
                        }
                    } catch(e) {}
                }
            }

            gols.sort((a, b) => (Number(b.created_at) || 0) - (Number(a.created_at) || 0));

            const totalEncontrados = gols.length;
            if (!queryText) {
                gols = gols.slice(0, 30);
            }

            let linhasTabela = gols.map(gol => `
                <tr id="row_${gol.id}">
                    <td class="id-cell"><code>${gol.id}</code></td>
                    <td>
                        <strong class="goal-title">${gol.jogo || 'Jogo'}</strong><br>
                        <span class="goal-meta">🏆 ${gol.campeonato || '-'} | ${gol.fase || '-'}</span>
                    </td>
                    <td class="goal-author">⚽ ${gol.autor || '-'}</td>
                    <td>
                        <div style="display:flex; gap:6px;">
                            <a href="/api/painel-addgoal?edit_id=${gol.id}" class="btn-edit">📝 Editar</a>
                            <button class="btn-delete" onclick="solicitarDelecao('${gol.id}', '${(gol.jogo || 'Gol').replace(/'/g, "\\'")}')">🗑️ Apagar</button>
                        </div>
                    </td>
                </tr>
            `).join('');

            const htmlLista = `
            <!DOCTYPE html>
            <html lang="pt-BR">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>📋 Lista de Gols Cadastrados</title>
                <link rel="preconnect" href="https://fonts.googleapis.com">
                <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
                <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@500;700&display=swap" rel="stylesheet">
                <style>
                    :root {
                        --bg-main: #0b0d10;
                        --card-bg: rgba(22, 26, 33, 0.85);
                        --border-color: rgba(255, 255, 255, 0.08);
                        --accent-red: #dc2626;
                        --accent-red-glow: rgba(220, 38, 38, 0.35);
                        --text-primary: #f8fafc;
                        --text-muted: #94a3b8;
                        --font-main: 'Plus Jakarta Sans', -apple-system, sans-serif;
                        --font-code: 'JetBrains Mono', monospace;
                    }

                    body { 
                        background-color: var(--bg-main); 
                        background-image: 
                            radial-gradient(at 10% 20%, rgba(220, 38, 38, 0.12) 0px, transparent 50%),
                            radial-gradient(at 90% 80%, rgba(185, 28, 28, 0.08) 0px, transparent 50%);
                        background-attachment: fixed;
                        color: var(--text-primary); 
                        font-family: var(--font-main); 
                        padding: 24px 15px; 
                        margin: 0; 
                        display: flex; 
                        justify-content: center; 
                        -webkit-font-smoothing: antialiased;
                    }

                    .container { 
                        width: 100%; 
                        max-width: 880px; 
                        background: var(--card-bg); 
                        backdrop-filter: blur(16px);
                        -webkit-backdrop-filter: blur(16px);
                        border-radius: 24px; 
                        padding: 30px; 
                        box-shadow: 0 30px 60px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.1); 
                        border: 1px solid var(--border-color); 
                        box-sizing: border-box; 
                    }

                    .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; gap: 10px; }
                    h1 { margin: 0; font-size: 26px; font-weight: 800; letter-spacing: -0.03em; }

                    .btn-back { 
                        background: #1e293b; 
                        color: #fff; 
                        text-decoration: none; 
                        padding: 10px 18px; 
                        border-radius: 12px; 
                        font-size: 14px; 
                        font-weight: 700; 
                        border: 1px solid var(--border-color); 
                        transition: all 0.2s ease;
                    }
                    .btn-back:hover { background: #334155; }

                    .search-container { position: relative; width: 100%; margin-bottom: 24px; }
                    .search-input { 
                        width: 100%; 
                        background: rgba(11, 13, 16, 0.8); 
                        border: 1px solid var(--border-color); 
                        border-radius: 14px; 
                        padding: 16px 16px 16px 46px; 
                        color: #fff; 
                        font-size: 15px; 
                        font-family: var(--font-main); 
                        outline: none; 
                        box-sizing: border-box; 
                        transition: all 0.2s ease;
                    }
                    .search-input:focus { border-color: var(--accent-red); box-shadow: 0 0 0 3px var(--accent-red-glow); }
                    .search-icon { position: absolute; left: 16px; top: 50%; transform: translateY(-50%); color: var(--text-muted); font-size: 18px; pointer-events: none; }

                    .table-wrapper { width: 100%; overflow-x: auto; border-radius: 14px; border: 1px solid var(--border-color); }
                    table { width: 100%; border-collapse: collapse; text-align: left; font-size: 14px; background: rgba(11, 13, 16, 0.6); }
                    th, td { padding: 16px; border-bottom: 1px solid rgba(255,255,255,0.05); }
                    th { background: rgba(30, 41, 59, 0.7); font-weight: 700; color: #cbd5e1; text-transform: uppercase; font-size: 12px; letter-spacing: 0.05em; }
                    tr:hover { background: rgba(255,255,255,0.02); }

                    .id-cell code { font-size: 12px; color: #f87171; font-family: var(--font-code); }
                    .goal-title { font-weight: 700; font-size: 15px; }
                    .goal-meta { font-size: 13px; color: var(--text-muted); margin-top: 2px; display: inline-block; }
                    .goal-author { font-weight: 600; color: #e2e8f0; }

                    .btn-edit { background: #1e293b; border: 1px solid var(--border-color); color: #fff; text-decoration: none; padding: 8px 14px; border-radius: 10px; font-size: 12px; font-weight: 700; display: inline-block; }
                    .btn-delete { background: linear-gradient(135deg, #ef4444, #991b1b); color: #fff; border:0; padding: 8px 14px; border-radius: 10px; font-size: 12px; font-weight: 700; font-family: var(--font-main); display: inline-block; cursor:pointer; }

                    .no-results { display: ${totalEncontrados === 0 ? 'block' : 'none'}; padding: 40px 20px; text-align: center; color: var(--text-muted); border: 1px dashed var(--border-color); border-radius: 14px; margin-top: 10px; }
                    .info-txt { font-size: 13px; color: var(--text-muted); margin-top: 12px; display: ${url.searchParams.get("q") ? 'none' : 'block'}; }

                    .modal-overlay { position: fixed; top:0; left:0; width:100%; height:100%; background: rgba(0,0,0,0.85); backdrop-filter: blur(8px); display:flex; align-items:center; justify-content:center; padding:15px; box-sizing:border-box; z-index:1000; opacity:0; pointer-events:none; transition: opacity 0.2s ease; }
                    .modal-overlay.active { opacity:1; pointer-events:auto; }
                    .modal-content { background:#161a21; border: 1px solid rgba(239,68,68,0.3); border-radius:20px; width:100%; max-width:440px; padding:24px; box-sizing:border-box; box-shadow: 0 25px 50px rgba(0,0,0,0.6); }
                    .modal-title { margin:0 0 10px 0; font-size:18px; font-weight:800; color:#ef4444; }
                    .modal-buttons { display:flex; justify-content:flex-end; gap:10px; margin-top:20px; }
                    .btn-modal-delete { background:#dc2626; color:#fff; border:0; padding:11px 18px; font-weight:700; font-family: var(--font-main); border-radius:10px; cursor:pointer; font-size:13px; }
                    .btn-modal-cancel { background:#1e293b; color:#fff; border:1px solid var(--border-color); padding:11px 18px; font-weight:700; font-family: var(--font-main); border-radius:10px; cursor:pointer; font-size:13px; }

                    @media (max-width: 600px) {
                        th, td { padding: 12px; font-size: 13px; }
                        h1 { font-size: 22px; }
                    }
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="header">
                        <h1>📋 Gols (${totalEncontrados})</h1>
                        <a href="/api/painel-addgoal" class="btn-back">🔙 Voltar</a>
                    </div>
                    
                    <div class="search-container">
                        <span class="search-icon">🔍</span>
                        <input type="text" id="searchInput" class="search-input" value="${url.searchParams.get("q") || ""}" placeholder="Buscar jogador, time ou campeonato... e pressione Enter" onkeydown="verificarTeclaEnter(event)">
                    </div>

                    <div class="table-wrapper" style="display: ${totalEncontrados === 0 ? 'none' : 'block'};">
                        <table id="golsTable">
                            <thead>
                                <tr>
                                    <th>ID</th>
                                    <th>Confronto / Campeonato</th>
                                    <th>Autor</th>
                                    <th>Ações</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${linhasTabela || ''}
                            </tbody>
                        </table>
                    </div>
                    
                    <div id="noResultsBox" class="no-results">
                        <strong>Nenhum gol encontrado com esses termos na busca global.</strong>
                    </div>

                    <div class="info-txt">💡 Exibindo apenas os 30 gols mais recentes para economizar dados. Use a barra de busca acima para varrer o histórico completo.</div>
                </div>

                <div id="deleteModal" class="modal-overlay">
                    <div class="modal-content">
                        <h3 class="modal-title">⚠️ Excluir Gol Permanentemente?</h3>
                        <p id="deleteModalText" style="font-size:14px; color:#e4e4e7; margin:0; line-height:1.5;"></p>
                        <p style="font-size:12px; color:#f87171; font-weight:700; margin:10px 0 0 0;">🚨 Essa ação é irreversível e removerá o gol do robô!</p>
                        <div class="modal-buttons">
                            <button class="btn-modal-cancel" onclick="fecharModalDelecao()">Cancelar</button>
                            <button class="btn-modal-delete" id="btnConfirmDelete" onclick="executarExclusaoDefinitiva()">🗑️ Apagar do KV</button>
                        </div>
                    </div>
                </div>

                <script>
                    let idParaExcluir = null;

                    function verificarTeclaEnter(e) {
                        if (e.key === 'Enter') {
                            const valor = document.getElementById('searchInput').value.trim();
                            window.location.href = '/api/lista-gols?q=' + encodeURIComponent(valor);
                        }
                    }

                    function solicitarDelecao(id, jogo) {
                        idParaExcluir = id;
                        document.getElementById('deleteModalText').innerHTML = 'Tem certeza que deseja apagar o gol do jogo <strong>' + jogo + '</strong> (ID: <code>' + id + '</code>)?';
                        document.getElementById('deleteModal').classList.add('active');
                    }

                    function fecharModalDelecao() {
                        document.getElementById('deleteModal').classList.remove('active');
                        idParaExcluir = null;
                    }

                    async function executarExclusaoDefinitiva() {
                        if (!idParaExcluir) return;
                        const btn = document.getElementById('btnConfirmDelete');
                        btn.disabled = true;
                        btn.innerText = 'Apagando...';

                        try {
                            const res = await fetch('/api/deletegoal?id=' + idParaExcluir, { method: 'DELETE' });
                            const data = await res.json();
                            
                            if (data.ok) {
                                alert('🗑️ Gol removido com sucesso!');
                                document.getElementById('row_' + idParaExcluir).remove();
                            } else {
                                alert('❌ Erro: ' + (data.error || 'Não foi possível apagar.'));
                            }
                        } catch (e) {
                            alert('❌ Erro crítico ao conectar com o servidor.');
                        } finally {
                            fecharModalDelecao();
                            btn.disabled = false;
                            btn.innerText = '🗑️ Apagar do KV';
                        }
                    }
                </script>
            </body>
            </html>
            `;
            return new Response(htmlLista, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
        } catch (e) {
            return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: { "Content-Type": "application/json" } });
        }
    }

    // ⚙️ MOTOR DO BOLÃO: /api/processar-bolao
    else if (url.pathname === "/api/processar-bolao" && request.method === "POST") {
        try {
            const data = await request.json();
            const postId = String(data.post_id || "");
            const userId = String(data.user_id || "");
            const textoOriginal = String(data.texto_bruto || "").trim();

            let bolaoStatus = await env.GOLS_FLAMENGO_KV.get("bolao_aberto");
            if (bolaoStatus === "false" || bolaoStatus === null) {
                await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                    method: "POST", headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ 
                        chat_id: data.chat_id, 
                        reply_to_message_id: Number(data.message_id), 
                        parse_mode: "Markdown", 
                        text: "⛔ *Palpites encerrados!*\n\nO bolão já foi fechado para esse jogo. Aguarde a próxima rodada! 🔴⚫" 
                    })
                });
                return new Response(JSON.stringify({ ok: false, error: "fechado" }), { status: 200, headers: headersCORS });
            }

            let palpiteExistente = await env.GOLS_FLAMENGO_KV.get(`palpite_user_${postId}_${userId}`);
            if (palpiteExistente) {
                let jsp = JSON.parse(palpiteExistente);
                await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                    method: "POST", headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ 
                        chat_id: data.chat_id, 
                        reply_to_message_id: Number(data.message_id), 
                        parse_mode: "Markdown", 
                        text: `⚠️ *Você já enviou um palpite!*\n\n📌 Seu palpite registrado: *${jsp.palpite}*\n\n• Não é permitido alterar ou enviar múltiplos palpites.` 
                    })
                });
                return new Response(JSON.stringify({ ok: false, error: "duplicado" }), { status: 200, headers: headersCORS });
            }

            let limpo = textoOriginal.replace(/×/g, "x").replace(/X/g, "x").replace(/–|—/g, "-").replace(/\s+/g, " ").trim();
            let direto = limpo.match(/(?:^|\D)(\d{1,2})\s*(?:x|-|a)\s*(\d{1,2})(?:\D|$)/i);
            
            let casa = "", fora = "", valido = false, tipoPlacar = "";
            if (direto) { 
                casa = direto[1]; fora = direto[2]; valido = true; tipoPlacar = "direto"; 
            } else {
                let semHorario = limpo.replace(/\b\d{1,2}\s*h\s*\d{0,2}\b/gi, " ").replace(/\b\d{1,2}:\d{2}\b/g, " ").replace(/\s+/g, " ").trim();
                let comTimes = semHorario.match(/(?:^|[\s.,;:!?])([A-Za-zÀ-ÿ.' -]{2,40})\s+(\d{1,2})\s+([A-Za-zÀ-ÿ.' -]{2,40})\s+(\d{1,2})(?:$|[\s.,;:!?])/i);
                if (comTimes) { 
                    casa = comTimes[2]; fora = comTimes[4]; valido = true; tipoPlacar = "times"; 
                } else {
                    let numeros = semHorario.match(/\b\d{1,2}\b/g);
                    if (numeros && numeros.length === 2) { casa = numeros[0]; fora = numeros[1]; valido = true; tipoPlacar = "dois_numeros"; }
                }
            }

            if (!valido) {
                await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                    method: "POST", headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ 
                        chat_id: data.chat_id, 
                        reply_to_message_id: Number(data.message_id), 
                        parse_mode: "HTML", 
                        text: "❌ <b>Formato de palpite inválido!</b>\n\n<blockquote>📌 Envie um placar inteligível. Exemplos:\n• 2x1\n• Flamengo 3x0 Coritiba</blockquote>" 
                    })
                });
                return new Response(JSON.stringify({ ok: false, error: "invalido" }), { status: 200, headers: headersCORS });
            }

            let palpiteFinal = casa + "x" + fora;

            let palpiteObjeto = {
                user_id: userId,
                nome: data.first_name,
                username: data.username,
                palpite: palpiteFinal,
                texto_original: textoOriginal,
                message_id: Number(data.message_id),
                chat_id: Number(data.chat_id),
                tipo: tipoPlacar,
                timestamp: Date.now()
            };

            let chaveListaGlobal = "palpites_" + postId;
            let listaGlobalRaw = await env.GOLS_FLAMENGO_KV.get(chaveListaGlobal);
            let listaGlobal = listaGlobalRaw ? JSON.parse(listaGlobalRaw) : {};
            listaGlobal[userId] = palpiteObjeto;
            
            await env.GOLS_FLAMENGO_KV.put(chaveListaGlobal, JSON.stringify(listaGlobal));
            await env.GOLS_FLAMENGO_KV.put(`palpite_user_${postId}_${userId}`, JSON.stringify(palpiteObjeto));

            await fetch(`https://api.telegram.org/bot${botToken}/setMessageReaction`, {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ 
                    chat_id: data.chat_id, 
                    message_id: Number(data.message_id), 
                    reaction: [{ type: "emoji", emoji: "👍" }] 
                })
            });

            return new Response(JSON.stringify({ ok: true }), { status: 200, headers: headersCORS });
        } catch (err) {
            return new Response(JSON.stringify({ ok: false, error: err.message }), { status: 500, headers: headersCORS });
        }
    }

    // 🗑️ ROTA DE AÇÃO: /api/deletegoal
    else if (url.pathname === "/api/deletegoal" && request.method === "DELETE") {
        try {
            const id = url.searchParams.get("id");
            if (!id) return new Response(JSON.stringify({ ok: false, error: "id_missing" }), { status: 400, headers: headersCORS });

            let indexRaw = await env.GOLS_FLAMENGO_KV.get("gols_index");
            let index = indexRaw ? JSON.parse(indexRaw) : [];
            index = index.map(x => String(x));
            
            if (!index.includes(String(id))) {
                return new Response(JSON.stringify({ ok: false, error: "ID não encontrado no acervo." }), { status: 404, headers: headersCORS });
            }

            let novoIndex = index.filter(x => String(x) !== String(id));
            novoIndex = novoIndex.map(x => Number(x) || x);
            await env.GOLS_FLAMENGO_KV.put("gols_index", JSON.stringify(novoIndex));

            await env.GOLS_FLAMENGO_KV.delete(`gol_${id}`);
            return new Response(JSON.stringify({ ok: true, mensagem: "Excluído com sucesso." }), { status: 200, headers: headersCORS });
        } catch (err) {
            return new Response(JSON.stringify({ ok: false, error: err.message }), { status: 500, headers: headersCORS });
        }
    }

    // 🔍 AUXILIAR DE BUSCA: /api/getgoal
    else if (url.pathname === "/api/getgoal" && request.method === "GET") {
        try {
            const id = url.searchParams.get("id");
            if(!id) return new Response(JSON.stringify({ ok: false, error: "id_missing" }), { status: 400, headers: headersCORS });
            const golRaw = await env.GOLS_FLAMENGO_KV.get(`gol_${id}`);
            if(!golRaw) return new Response(JSON.stringify({ ok: false, error: "not_found" }), { status: 404, headers: headersCORS });
            return new Response(JSON.stringify({ ok: true, gol: JSON.parse(golRaw) }), { status: 200, headers: headersCORS });
        } catch (e) {
            return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: headersCORS });
        }
    }

    // ⚡ AÇÃO INTEGRADA DA API: /api/addgoal-action
    else if (url.pathname === "/api/addgoal-action" && request.method === "POST") {
        try {
            const body = await request.json();
            if (String(body.admin_id) !== "7717528550") return new Response(JSON.stringify({ ok: false, error: "Acesso Negado." }), { status: 401, headers: headersCORS });

            const isEditing = body.id && body.id.trim() !== "";
            const goalId = isEditing ? body.id.trim() : String(Date.now());
            
            let oldData = {};
            if (isEditing) {
                const oldRaw = await env.GOLS_FLAMENGO_KV.get(`gol_${goalId}`);
                if (!oldRaw) return new Response(JSON.stringify({ ok: false, error: "ID não encontrado." }), { status: 404, headers: headersCORS });
                oldData = JSON.parse(oldRaw);
            }

            const safeNormalize = (text) => {
                if (!text) return "";
                try { text = text.toLowerCase().trim().normalize("NFD").replace(/[\u0300-\u036f]/g, ""); } catch (e) {}
                return text.replace(/[^\w\s]/g, "").replace(/\s+/g, " ").trim();
            };

            const search = safeNormalize(`${body.jogo || ""} ${body.autor || ""} ${body.assistencia || ""} ${body.campeonato || ""} ${body.fase || ""}`);

            const goalData = {
                id: Number(goalId) || goalId,
                jogo: body.jogo.trim(),
                autor: body.autor.trim(),
                assistencia: body.assistencia.trim(),
                campeonato: body.campeonato.trim(),
                fase: body.fase.trim(),
                file_id: body.file_id.trim(),
                views: oldData.views || 0,
                created_at: oldData.created_at || Date.now(),
                updated_at: Date.now(),
                search: search,
                admin_id: Number(body.admin_id)
            };

            await env.GOLS_FLAMENGO_KV.put(`gol_${goalId}`, JSON.stringify(goalData));

            if (!isEditing) {
                let indexRaw = await env.GOLS_FLAMENGO_KV.get("gols_index");
                let index = indexRaw ? JSON.parse(indexRaw) : [];
                if (!index.includes(Number(goalId)) && !index.includes(String(goalId))) {
                    index.push(Number(goalId) || goalId);
                }
                await env.GOLS_FLAMENGO_KV.put("gols_index", JSON.stringify(index));
            }

            try {
                const CANAL_BACKUP = "-1003703318973";
                const txtStatus = isEditing ? "📝 Gol editado e modificado" : "📌 Novo gol adicionado";
                await fetch(`https://api.telegram.org/bot${botToken}/sendVideo`, {
                    method: "POST", headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        chat_id: CANAL_BACKUP, video: goalData.file_id,
                        caption: `📌 <b>${txtStatus} via Painel Web</b>\n\n🆔 <code>${goalData.id}</code>\n⚽ ${goalData.jogo}\n\n#⃣ Autor: ${goalData.autor}\n🅰 Assistência: ${goalData.assistencia}\n🏆 ${goalData.campeonato} - ${goalData.fase}`,
                        parse_mode: "HTML"
                    })
                });
            } catch (e) {}

            return new Response(JSON.stringify({ ok: true, id: goalId }), { status: 200, headers: headersCORS });
        } catch (err) {
            return new Response(JSON.stringify({ ok: false, error: err.message }), { status: 500, headers: headersCORS });
        }
    }

    // 🔄 ROTA MIGRATÓRIA: /api/importar-tudo
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

    // 🏆 APURAÇÃO DO BOLÃO: /api/apurar-bolao
    else if (url.pathname === "/api/apurar-bolao" && request.method === "POST") {
        try {
            const body = await request.json();
            const adminId = String(body.admin_id || "");
            const postId = String(body.post_id || "");
            const placarReal = String(body.placar_real || "").toLowerCase().trim();

            if (adminId !== "7717528550") {
                return new Response(JSON.stringify({ ok: false, error: "Acesso negado" }), { status: 401, headers: headersCORS });
            }

            let chaveListaGlobal = "palpites_" + postId;
            let listaGlobalRaw = await env.GOLS_FLAMENGO_KV.get(chaveListaGlobal);
            if (!listaGlobalRaw) {
                return new Response(JSON.stringify({ ok: false, error: "Nenhum palpite encontrado para esta postagem." }), { status: 404, headers: headersCORS });
            }
            let listaPalpites = JSON.parse(listaGlobalRaw);

            let rankingRaw = await env.GOLS_FLAMENGO_KV.get("ranking_global");
            let namesRaw = await env.GOLS_FLAMENGO_KV.get("ranking_names");
            let rankingGlobal = rankingRaw ? JSON.parse(rankingRaw) : {};
            let rankingNames = namesRaw ? JSON.parse(namesRaw) : {};

            let ganhadoresId = [];
            let contagemGanhadores = 0;

            for (let uid in listaPalpites) {
                let dadosTorcedor = listaPalpites[uid];
                
                if (dadosTorcedor.palpite === placarReal) {
                    ganhadoresId.push(uid);
                    contagemGanhadores++;

                    rankingGlobal[uid] = (Number(rankingGlobal[uid]) || 0) + 1;
                    rankingNames[uid] = dadosTorcedor.nome || "Torcedor";

                    let acertosRaw = await env.GOLS_FLAMENGO_KV.get("acertos_" + uid);
                    let acertosLista = acertosRaw ? JSON.parse(acertosRaw) : [];
                    if (!Array.isArray(acertosLista)) acertosLista = [];
                    if (!acertosLista.includes(postId)) {
                        acertosLista.push(postId);
                        await env.GOLS_FLAMENGO_KV.put("acertos_" + uid, JSON.stringify(acertosLista));
                    }
                }
            }

            if (contagemGanhadores > 0) {
                await env.GOLS_FLAMENGO_KV.put("ranking_global", JSON.stringify(rankingGlobal));
                await env.GOLS_FLAMENGO_KV.put("ranking_names", JSON.stringify(rankingNames));
            }

            await env.GOLS_FLAMENGO_KV.delete(chaveListaGlobal);

            return new Response(JSON.stringify({ 
                ok: true, 
                ganhadores_contagem: contagemGanhadores,
                ganhadores_lista: ganhadoresId 
            }), { status: 200, headers: headersCORS });

        } catch (err) {
            return new Response(JSON.stringify({ ok: false, error: err.message }), { status: 500, headers: headersCORS });
        }
    }

    return new Response(JSON.stringify({ erro: "Rota não encontrada" }), { status: 404, headers: headersCORS });
}
