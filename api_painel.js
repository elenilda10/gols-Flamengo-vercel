// ==========================================================
// 🌐 PROCESSADOR DE APIS E PAINEL WEB DIRECT DEPLOY (CLOUDFLARE)
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

    // 🖥️ PAINEL VISUAL: /api/painel-addgoal (Com Confirmação Expandida)
    else if (url.pathname === "/api/painel-addgoal" && request.method === "GET") {
        const htmlForm = `
        <!DOCTYPE html>
        <html lang="pt-BR">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>⚽ Painel de Controle - Gols do Flamengo</title>
            <style>
                body { background-color: #09090b; color: #fff; font-family: -apple-system, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 15px; box-sizing: border-box; }
                .card { width: 100%; max-width: 550px; background: #18181b; border-radius: 20px; padding: 25px; box-shadow: 0 20px 40px rgba(0,0,0,0.5); border: 1px solid rgba(255,255,255,0.08); box-sizing: border-box; }
                h1 { margin: 0 0 5px 0; font-size: 24px; font-weight: 800; }
                p { color: #a1a1aa; margin: 0 0 15px 0; font-size: 14px; }
                .nav-link { display: inline-block; color: #f87171; font-size: 14px; font-weight: 700; text-decoration: none; margin-bottom: 20px; border-bottom: 1px dashed #f87171; padding-bottom: 2px; }
                .alert { padding: 12px; border-radius: 10px; margin-bottom: 18px; font-size: 14px; font-weight: 600; display: none; border: 1px solid rgba(255,255,255,0.1); word-break: break-all; }
                form { display: flex; flex-direction: column; gap: 15px; }
                .row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
                .search-row { display: grid; grid-template-columns: 1fr auto; gap: 10px; align-items: flex-end; background: rgba(255,255,255,0.02); padding: 12px; border-radius: 12px; border: 1px dashed rgba(255,255,255,0.1); margin-bottom: 5px; }
                .field { display: flex; flex-direction: column; gap: 5px; }
                label { font-size: 12px; font-weight: 600; color: #d4d4d8; }
                input { background: #09090b; border: 1px solid rgba(255,255,255,0.15); border-radius: 10px; padding: 14px 12px; color: #fff; font-size: 15px; outline: none; width: 100%; box-sizing: border-box; }
                .btn-primary { background: linear-gradient(135deg, #ef4444, #b91c1c); color: #fff; border: 0; border-radius: 12px; padding: 16px; font-size: 15px; font-weight: 700; cursor: pointer; margin-top: 5px; box-shadow: 0 8px 12px rgba(239, 68, 68, 0.2); width: 100%; }
                .btn-secondary { background: #27272a; color: #fff; border: 1px solid rgba(255,255,255,0.1); border-radius: 10px; padding: 13px 18px; font-size: 14px; font-weight: 700; cursor: pointer; height: 47px; box-sizing: border-box; }
                
                /* Estilos dos Modais Popups */
                .modal-overlay { position: fixed; top:0; left:0; width:100%; height:100%; background: rgba(0,0,0,0.8); display:flex; align-items:center; justify-content:center; padding:15px; box-sizing:border-box; z-index:1000; opacity:0; pointer-events:none; transition: opacity 0.2s ease; }
                .modal-overlay.active { opacity:1; pointer-events:auto; }
                .modal-content { background:#18181b; border: 1px solid rgba(255,255,255,0.12); border-radius:18px; width:100%; max-width:480px; padding:22px; box-sizing:border-box; box-shadow: 0 25px 50px rgba(0,0,0,0.6); }
                .modal-title { margin:0 0 10px 0; font-size:20px; font-weight:800; display:flex; align-items:center; gap:8px; }
                .modal-body { font-size:14px; color:#e4e4e7; line-height:1.5; background:#09090b; padding:12px; border-radius:10px; border:1px solid rgba(255,255,255,0.06); margin-bottom:18px; max-height:260px; overflow-y:auto; }
                .modal-buttons { display:flex; justify-content:flex-end; gap:10px; }
                .btn-modal-confirm { background:#ef4444; color:#fff; border:0; padding:11px 18px; font-weight:700; border-radius:8px; cursor:pointer; font-size:14px; }
                .btn-modal-cancel { background:#27272a; color:#fff; border:1px solid rgba(255,255,255,0.08); padding:11px 18px; font-weight:700; border-radius:8px; cursor:pointer; font-size:14px; }
                
                @media (max-width: 600px) {
                    body { padding: 10px; }
                    .card { padding: 20px; border-radius: 16px; }
                    h1 { font-size: 22px; }
                    .row { grid-template-columns: 1fr; gap: 15px; }
                    input { padding: 12px; font-size: 14px; }
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
                        <label>ID do Gol (Deixe em branco para NOVO GOL)</label>
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
                    <h3 class="modal-title">⚠️ Confirmar Registro do Gol?</h3>
                    <p style="font-size:13px; color:#a1a1aa; margin:0 0 12px 0;">Confira os dados antes de gravar de forma definitiva:</p>
                    <div id="modalDataPreview" class="modal-body"></div>
                    <div class="modal-buttons">
                        <button class="btn-modal-cancel" onclick="fecharModal()">🔙 Voltar</button>
                        <button class="btn-modal-confirm" style="background:#065f46;" onclick="executarEnvioDefinitivo()">✅ Confirmar e Salvar</button>
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

                    modalDataPreview.innerHTML = \`
                        <strong>🆔 ID:</strong> \${idText}<br>
                        <strong>⚽ Jogo:</strong> \${jogo}<br>
                        <strong>👤 Autor:</strong> \${autor}<br>
                        <strong>🅰️ Assistência:</strong> \${assistencia}<br>
                        <strong>🏆 Campeonato:</strong> \${campeonato}<br>
                        <strong>📍 Fase/Rodada:</strong> \${fase}<br>
                        <strong style="display:block; margin-top:5px; margin-bottom:2px;">📂 FileID:</strong>
                        <span style="font-size:11px; color:#f87171; font-family:monospace; word-break:break-all;">\${file_id}</span>
                    \`;
                    
                    confirmModal.classList.add('active');
                }

                function fecharModal() {
                    confirmModal.classList.remove('active');
                }

                async function ejecutarEnvioDefinitivo() {
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

    // 📋 LISTA DE GOLS TURBO: /api/lista-gols (Com Função Exclusiva de Deletar + Confirmação)
    else if (url.pathname === "/api/lista-gols" && request.method === "GET") {
        try {
            let indexRaw = await env.GOLS_FLAMENGO_KV.get("gols_index");
            let index = indexRaw ? JSON.parse(indexRaw) : [];

            let loteDadosRaw = await Promise.all(index.map(id => env.GOLS_FLAMENGO_KV.get(`gol_${id}`)));
            let gols = [];

            for (let i = 0; i < loteDadosRaw.length; i++) {
                if (loteDadosRaw[i]) {
                    gols.push(JSON.parse(loteDadosRaw[i]));
                }
            }

            gols.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));

            let linhasTabela = gols.map(gol => `
                <tr id="row_${gol.id}" data-search="${gol.search || ''}">
                    <td class="id-cell"><code>${gol.id}</code></td>
                    <td>
                        <strong class="goal-title">${gol.jogo || 'Jogo'}</strong><br>
                        <span class="goal-meta">🏆 ${gol.campeonato || '-'} | ${gol.fase || '-'}</span>
                    </td>
                    <td class="goal-author">⚽ ${gol.autor || '-'}</td>
                    <td>
                        <div style="display:flex; gap:6px;">
                            <a href="/api/painel-addgoal?edit_id=${gol.id}" class="btn-edit">📝 Editar</a>
                            <button class="btn-delete" onclick="solicitarDelecao('${gol.id}', '${gol.jogo.replace(/'/g, "\\'")}')">🗑️ Apagar</button>
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
                <style>
                    body { background-color: #09090b; color: #fff; font-family: -apple-system, sans-serif; padding: 20px; margin: 0; display: flex; justify-content: center; }
                    .container { width: 100%; max-width: 850px; background: #18181b; border-radius: 20px; padding: 25px; box-shadow: 0 20px 40px rgba(0,0,0,0.5); border: 1px solid rgba(255,255,255,0.08); box-sizing: border-box; }
                    .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; gap: 10px; }
                    h1 { margin: 0; font-size: 24px; font-weight: 800; }
                    .btn-back { background: #27272a; color: #fff; text-decoration: none; padding: 10px 16px; border-radius: 10px; font-size: 14px; font-weight: 700; border: 1px solid rgba(255,255,255,0.1); }
                    
                    .search-container { position: relative; width: 100%; margin-bottom: 20px; }
                    .search-input { width: 100%; background: #09090b; border: 1px solid rgba(255,255,255,0.12); border-radius: 12px; padding: 15px 15px 15px 42px; color: #fff; font-size: 15px; outline: none; box-sizing: border-box; }
                    .search-input:focus { border-color: rgba(239,68,68,0.5); box-shadow: 0 0 0 2px rgba(239,68,68,0.15); }
                    .search-icon { position: absolute; left: 15px; top: 50%; transform: translateY(-50%); color: #a1a1aa; font-size: 16px; pointer-events: none; }
                    
                    .table-wrapper { width: 100%; overflow-x: auto; border-radius: 12px; border: 1px solid rgba(255,255,255,0.08); }
                    table { width: 100%; border-collapse: collapse; text-align: left; font-size: 14px; background: #09090b; }
                    th, td { padding: 14px; border-bottom: 1px solid rgba(255,255,255,0.06); }
                    th { background: #1f1f23; font-weight: 700; color: #d4d4d8; }
                    tr:hover { background: rgba(255,255,255,0.02); }
                    .id-cell { font-size: 12px; color: #f87171; }
                    .btn-edit { background: #27272a; border: 1px solid rgba(255,255,255,0.1); color: #fff; text-decoration: none; padding: 7px 12px; border-radius: 8px; font-size: 12px; font-weight: 700; display: inline-block; }
                    .btn-delete { background: linear-gradient(135deg, #ef4444, #b91c1c); color: #fff; border:0; padding: 7px 12px; border-radius: 8px; font-size: 12px; font-weight: 700; display: inline-block; cursor:pointer; }
                    .no-results { display: none; padding: 30px; text-align: center; color: #a1a1aa; border: 1px dashed rgba(255,255,255,0.1); border-radius: 12px; margin-top: 10px; }
                    
                    /* Modal de Deleção */
                    .modal-overlay { position: fixed; top:0; left:0; width:100%; height:100%; background: rgba(0,0,0,0.85); display:flex; align-items:center; justify-content:center; padding:15px; box-sizing:border-box; z-index:1000; opacity:0; pointer-events:none; transition: opacity 0.2s ease; }
                    .modal-overlay.active { opacity:1; pointer-events:auto; }
                    .modal-content { background:#18181b; border: 1px solid rgba(239,68,68,0.25); border-radius:18px; width:100%; max-width:420px; padding:22px; box-sizing:border-box; box-shadow: 0 25px 50px rgba(0,0,0,0.6); }
                    .modal-title { margin:0 0 10px 0; font-size:18px; font-weight:800; color:#ef4444; }
                    .modal-buttons { display:flex; justify-content:flex-end; gap:10px; margin-top:20px; }
                    .btn-modal-delete { background:#ef4444; color:#fff; border:0; padding:10px 16px; font-weight:700; border-radius:8px; cursor:pointer; font-size:13px; }
                    .btn-modal-cancel { background:#27272a; color:#fff; border:1px solid rgba(255,255,255,0.08); padding:10px 16px; font-weight:700; border-radius:8px; cursor:pointer; font-size:13px; }

                    @media (max-width: 600px) {
                        th, td { padding: 10px; font-size: 13px; }
                        h1 { font-size: 20px; }
                        .search-input { padding: 12px 12px 12px 36px; font-size: 14px; }
                    }
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="header">
                        <h1>📋 Gols Cadastrados (<span id="totalCounter">${gols.length}</span>)</h1>
                        <a href="/api/painel-addgoal" class="btn-back">🔙 Voltar</a>
                    </div>
                    
                    <div class="search-container">
                        <span class="search-icon">🔍</span>
                        <input type="text" id="searchInput" class="search-input" placeholder="Buscar jogador, time ou campeonato..." oninput="filtrarGols()">
                    </div>

                    <div class="table-wrapper">
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
                                ${linhasTabela || '<tr><td colspan="4" style="text-align:center;">Nenhum gol cadastrado ainda.</td></tr>'}
                            </tbody>
                        </table>
                    </div>
                    
                    <div id="noResultsBox" class="no-results">
                        <strong>Nenhum gol encontrado com esses termos.</strong>
                    </div>
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

                    function filtrarGols() {
                        const input = document.getElementById('searchInput');
                        let query = input.value.toLowerCase().trim().normalize("NFD").replace(/[\\u0300-\\u036f]/g, "").replace(/[^a-z0-9\\s]/g, "");
                        const termos = query.split(" ").filter(Boolean);
                        const rows = document.querySelectorAll('#golsTable tbody tr');
                        let visiveis = 0;

                        rows.forEach(row => {
                            const targetText = row.getAttribute('data-search') || '';
                            const match = termos.every(term => targetText.includes(term));
                            if (match) { row.style.display = ''; visiveis++; } else { row.style.display = 'none'; }
                        });
                        document.getElementById('totalCounter').innerText = visiveis;
                        document.querySelector('.table-wrapper').style.display = visiveis === 0 ? 'none' : 'block';
                        document.getElementById('noResultsBox').style.display = visiveis === 0 ? 'block' : 'none';
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
                                const row = document.getElementById('row_' + idParaExcluir);
                                if (row) row.remove();
                                // Atualiza o contador do cabeçalho
                                const counter = document.getElementById('totalCounter');
                                counter.innerText = Number(counter.innerText) - 1;
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
            return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: headersCORS });
        }
    }

    // 🗑️ NOVA ROTA DE AÇÃO: /api/deletegoal (Remove o gol do índice e deleta a chave individual no KV)
    else if (url.pathname === "/api/deletegoal" && request.method === "DELETE") {
        try {
            const id = url.searchParams.get("id");
            if (!id) return new Response(JSON.stringify({ ok: false, error: "id_missing" }), { status: 400, headers: headersCORS });

            // 1. Pega e atualiza o índice de buscas
            let indexRaw = await env.GOLS_FLAMENGO_KV.get("gols_index");
            let index = indexRaw ? JSON.parse(indexRaw) : [];

            // Converte tudo para string e número para evitar qualquer falha de tipo primitivo
            index = index.map(x => String(x));
            
            if (!index.includes(String(id))) {
                return new Response(JSON.stringify({ ok: false, error: "ID não encontrado no acervo." }), { status: 404, headers: headersCORS });
            }

            // Filtra removendo o ID deletado
            let novoIndex = index.filter(x => String(x) !== String(id));
            // Transforma de volta para número para manter o padrão antigo do seu robô
            novoIndex = novoIndex.map(x => Number(x) || x);
            await env.GOLS_FLAMENGO_KV.put("gols_index", JSON.stringify(novoIndex));

            // 2. Remove o registro definitivo do gol no banco KV
            await env.GOLS_FLAMENGO_KV.delete(`gol_${id}`);

            return new Response(JSON.stringify({ ok: true, mensagem: "Gol excluído com sucesso do banco KV." }), { status: 200, headers: headersCORS });
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
                        caption: `📌 <b>${txtStatus} via Painel Web</b>\n\n🆔 <code>${goalData.id}</code>\n⚽ ${goalData.jogo}\n\n👟 Autor: ${goalData.autor}\n🅰 Assistência: ${goalData.assistencia}\n🏆 ${goalData.campeonato} - ${goalData.fase}`,
                        parse_mode: "HTML"
                    })
                });
            } catch (e) {}

            return new Response(JSON.stringify({ ok: true, id: goalId }), { status: 200, headers: headersCORS });
        } catch (err) {
            return new Response(JSON.stringify({ ok: false, error: err.message }), { status: 500, headers: headersCORS });
        }
    }

    // 🔄 ROTA 6: /api/importar-tudo
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
