// ==========================================================
// ⚙️ HELPERS PARA A TABELA DE CONFIGURAÇÕES (D1)
// ==========================================================
async function getConfig(db, chave) {
    const row = await db.prepare("SELECT valor FROM config WHERE chave = ?").bind(chave).first();
    return row ? row.valor : null;
}

async function setConfig(db, chave, valor) {
    await db.prepare("INSERT OR REPLACE INTO config (chave, valor) VALUES (?, ?)").bind(chave, String(valor)).run();
}

async function deleteConfig(db, chave) {
    await db.prepare("DELETE FROM config WHERE chave = ?").bind(chave).run();
}

// ==========================================================
// 🌐 PROCESSADOR DE APIS, GERENCIADOR WEB E MOTOR DE BOLÃO
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

    // ==========================================================
    // 🚀 ROTA DE MIGRAÇÃO EM LOTES (CORRIGIDA CONTRA FOREIGN KEY)
    // ==========================================================
    if (url.pathname === "/api/migrar-tudo" && request.method === "GET") {
        try {
            const cursor = url.searchParams.get("cursor") || "";
            const tipo = url.searchParams.get("tipo") || "acertos";
            
            let prefixo = "acertos_";
            if (tipo === "resgates") prefixo = "resgate_concluido_";
            if (tipo === "usuarios") prefixo = "user_";

            const lista = await env.GOLS_FLAMENGO_KV.list({ prefix: prefixo, limit: 25, cursor: cursor || undefined });
            const chaves = lista.keys.map(k => k.name);

            let processados = 0;

            for (const chave of chaves) {
                try {
                    if (tipo === "resgates") {
                        const partes = chave.replace("resgate_concluido_", "").split("_");
                        const postId = partes[0];
                        const uid = Number(partes[1]);
                        if (postId && uid > 0) {
                            await env.DB.prepare(`INSERT OR IGNORE INTO usuarios (id, nome, criado_em) VALUES (?, 'Torcedor', ?)`).bind(uid, Date.now()).run();
                            await env.DB.prepare(`INSERT OR IGNORE INTO boloes (postagem_id, confronto, criado_em) VALUES (?, 'Histórico', ?)`).bind(postId, Date.now()).run();
                            await env.DB.prepare(`
                                INSERT OR IGNORE INTO acertos (postagem_id, user_id, confronto, placar, resgatado, resgatado_em)
                                VALUES (?, ?, 'Bolão Oficial', 'Acerto Confirmado', 1, ?)
                            `).bind(postId, uid, Date.now()).run();
                            processados++;
                        }
                    } else if (tipo === "usuarios") {
                        const uid = Number(chave.replace("user_", ""));
                        if (uid > 0) {
                            const lang = (await env.GOLS_FLAMENGO_KV.get(`lang_${uid}`)) || "pt";
                            await env.DB.prepare(`
                                INSERT INTO usuarios (id, nome, idioma, pontos, criado_em)
                                VALUES (?, 'Torcedor', ?, 0, ?)
                                ON CONFLICT(id) DO UPDATE SET idioma = excluded.idioma
                            `).bind(uid, lang, Date.now()).run();
                            processados++;
                        }
                    } else {
                        const raw = await env.GOLS_FLAMENGO_KV.get(chave);
                        if (!raw) continue;

                        if (chave.startsWith("acertos_total_")) {
                            const uid = Number(chave.replace("acertos_total_", ""));
                            const totalPontos = Number(raw) || 0;
                            if (uid > 0 && totalPontos > 0) {
                                await env.DB.prepare(`
                                    INSERT INTO usuarios (id, nome, pontos, criado_em)
                                    VALUES (?, 'Torcedor', ?, ?)
                                    ON CONFLICT(id) DO UPDATE SET pontos = MAX(usuarios.pontos, excluded.pontos)
                                `).bind(uid, totalPontos, Date.now()).run();
                                processados++;
                            }
                        } else {
                            const uid = Number(chave.replace("acertos_", ""));
                            if (uid > 0) {
                                let itens = [];
                                try {
                                    itens = JSON.parse(raw);
                                    if (typeof itens === "string") itens = [itens];
                                    if (!Array.isArray(itens)) itens = [];
                                } catch (e) {
                                    itens = [raw];
                                }

                                await env.DB.prepare(`INSERT OR IGNORE INTO usuarios (id, nome, criado_em) VALUES (?, 'Torcedor', ?)`).bind(uid, Date.now()).run();

                                for (const item of itens) {
                                    const partes = String(item).split("->");
                                    const confronto = partes[0]?.trim() || String(item);
                                    const placar = partes[1]?.trim() || "Placar Correto";
                                    const dummyPostId = "migrado_" + Math.random().toString(36).substring(2, 9);

                                    await env.DB.prepare(`INSERT OR IGNORE INTO boloes (postagem_id, confronto, criado_em) VALUES (?, ?, ?)`).bind(dummyPostId, confronto, Date.now()).run();

                                    await env.DB.prepare(`
                                        INSERT OR IGNORE INTO acertos (postagem_id, user_id, confronto, placar, resgatado, resgatado_em)
                                        VALUES (?, ?, ?, ?, 1, ?)
                                    `).bind(dummyPostId, uid, confronto, placar, Date.now()).run();
                                    processados++;
                                }
                            }
                        }
                    }
                } catch (e) {}
            }

            return new Response(JSON.stringify({
                ok: true,
                tipo: tipo,
                processados_neste_lote: processados,
                concluido: lista.list_complete,
                proximo_cursor: lista.cursor || null
            }), { status: 200, headers: headersCORS });

        } catch (err) {
            return new Response(JSON.stringify({ ok: false, error: err.message }), { status: 500, headers: headersCORS });
        }
    }

    // ==========================================================
    // 📊 API 1: /api/ranking_api (Tabela Completa com Fotos, Nomes e Acertos)
    // ==========================================================
    else if (url.pathname === "/api/ranking_api") {
        try {
            const { results: usuarios } = await env.DB.prepare(`
                SELECT id, nome, pontos, foto_url 
                FROM usuarios 
                WHERE pontos > 0 
                ORDER BY pontos DESC
            `).all();

            const rankingArray = await Promise.all(usuarios.map(async (u) => {
                const uid = String(u.id);
                let finalPhotoUrl = u.foto_url || "";

                if (!finalPhotoUrl && botToken) {
                    try {
                        const photosRes = await fetch(`https://api.telegram.org/bot${botToken}/getUserProfilePhotos?user_id=${uid}&limit=1`);
                        const photosData = await photosRes.json();

                        if (photosData.ok && photosData.result?.photos?.length > 0) {
                            const fileId = photosData.result.photos[0][0].file_id;
                            const fileRes = await fetch(`https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`);
                            const fileData = await fileRes.json();

                            if (fileData.ok && fileData.result?.file_path) {
                                finalPhotoUrl = `https://api.telegram.org/file/bot${botToken}/${fileData.result.file_path}`;
                                await env.DB.prepare("UPDATE usuarios SET foto_url = ?, foto_file_id = ? WHERE id = ?").bind(finalPhotoUrl, fileId, u.id).run();
                            }
                        }
                    } catch (e) {}
                }

                const sanitizarNome = (str) => {
                    if (!str) return "Torcedor";
                    return str.replace(/[\u0000-\u001F\u007F-\u009F\uFFFD]/g, "").trim() || "Torcedor";
                };

                let nomeLimpo = sanitizarNome(u.nome);

                if (!finalPhotoUrl) {
                    finalPhotoUrl = `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(nomeLimpo)}&backgroundColor=dc2626&textColor=ffffff&bold=true`;
                }

                const { results: userAcertos } = await env.DB.prepare(`
                    SELECT confronto, placar, resgatado_em 
                    FROM acertos 
                    WHERE user_id = ? 
                    ORDER BY CAST(resgatado_em AS INTEGER) DESC
                `).bind(u.id).all();

                const listaFormatadaAcertos = userAcertos.map(a => `${a.confronto} -> ${a.placar}`);

                return {
                    id: uid,
                    uid: uid,
                    nome: nomeLimpo,
                    name: nomeLimpo,
                    pontos: u.pontos,
                    total: u.pontos,
                    acertos: listaFormatadaAcertos,
                    historico_acertos: userAcertos,
                    photo_url: finalPhotoUrl,
                    photo_file_id: finalPhotoUrl
                };
            }));

            return new Response(JSON.stringify({ ok: true, ranking: rankingArray }), { status: 200, headers: headersCORS });
        } catch (err) {
            return new Response(JSON.stringify({ ok: false, error: err.message }), { status: 500, headers: headersCORS });
        }
    }

    // ==========================================================
    // 👤 API 2: /api/ranking_user_public_api (Perfil Individual com Acertos)
    // ==========================================================
    else if (url.pathname === "/api/ranking_user_public_api") {
        try {
            let uid = url.searchParams.get("uid") || url.searchParams.get("id");
            if (!uid) return new Response(JSON.stringify({ ok: false, error: "uid_missing" }), { status: 400, headers: headersCORS });
            uid = Number(uid);

            const user = await env.DB.prepare("SELECT id, nome, pontos, foto_url FROM usuarios WHERE id = ?").bind(uid).first();
            if (!user) {
                return new Response(JSON.stringify({ ok: false, error: "user_not_found" }), { status: 404, headers: headersCORS });
            }

            const posicaoRow = await env.DB.prepare("SELECT COUNT(*) + 1 as pos FROM usuarios WHERE pontos > ?").bind(user.pontos).first();
            const posicao = posicaoRow?.pos || 1;

            const { results: userAcertos } = await env.DB.prepare(`
                SELECT confronto, placar, resgatado_em 
                FROM acertos 
                WHERE user_id = ? 
                ORDER BY CAST(resgatado_em AS INTEGER) DESC
            `).bind(uid).all();

            const listaFormatadaAcertos = userAcertos.map(a => `${a.confronto} -> ${a.placar}`);

            let photoUrl = user.foto_url || "";
            if (!photoUrl) {
                photoUrl = `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(user.nome || "Torcedor")}&backgroundColor=dc2626&textColor=ffffff&bold=true`;
            }

            return new Response(JSON.stringify({ 
                ok: true, 
                uid: String(user.id), 
                id: String(user.id),
                nome: user.nome || "Torcedor", 
                pontos: user.pontos || 0, 
                total: user.pontos || 0,
                posicao: posicao,
                acertos: listaFormatadaAcertos,
                historico: userAcertos,
                photo_url: photoUrl
            }), { status: 200, headers: headersCORS });
        } catch (err) {
            return new Response(JSON.stringify({ ok: false, error: err.message }), { status: 500, headers: headersCORS });
        }
    }

    // ==========================================================
    // 🏆 PAINEL WEBAPP DO BOLÃO: /api/painel-bolao
    // ==========================================================
    else if (url.pathname === "/api/painel-bolao" && request.method === "GET") {
        let bolaoAberto = (await getConfig(env.DB, "bolao_aberto")) || "false";
        let confrontoAtual = (await getConfig(env.DB, "confronto_atual")) || "Nenhum no momento";
        let postAtivoId = (await getConfig(env.DB, "postagem_ativa_id")) || "Nenhum";
        let vencedoresTemp = (await getConfig(env.DB, "vencedores_temporarios")) || "";

        const htmlBolao = `
        <!DOCTYPE html>
        <html lang="pt-BR">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>🏆 Painel Geral do Bolão</title>
            <link rel="preconnect" href="https://fonts.googleapis.com">
            <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
            <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@500;700&display=swap" rel="stylesheet">
            <style>
                :root {
                    --bg-main: #0b0d10;
                    --card-bg: rgba(22, 26, 33, 0.88);
                    --border-color: rgba(255, 255, 255, 0.08);
                    --accent-red: #dc2626;
                    --accent-green: #16a34a;
                    --accent-blue: #2563eb;
                    --accent-orange: #d97706;
                    --text-primary: #f8fafc;
                    --text-muted: #94a3b8;
                    --font-main: 'Plus Jakarta Sans', -apple-system, sans-serif;
                    --font-code: 'JetBrains Mono', monospace;
                }

                body { 
                    background-color: var(--bg-main); 
                    background-image: radial-gradient(at 10% 20%, rgba(220, 38, 38, 0.1) 0px, transparent 50%),
                                      radial-gradient(at 90% 80%, rgba(37, 99, 235, 0.08) 0px, transparent 50%);
                    background-attachment: fixed;
                    color: var(--text-primary); 
                    font-family: var(--font-main); 
                    padding: 20px 15px; 
                    margin: 0; 
                    display: flex; 
                    justify-content: center; 
                    -webkit-font-smoothing: antialiased;
                }

                .container { 
                    width: 100%; 
                    max-width: 640px; 
                    background: var(--card-bg); 
                    backdrop-filter: blur(16px);
                    -webkit-backdrop-filter: blur(16px);
                    border-radius: 24px; 
                    padding: 28px; 
                    border: 1px solid var(--border-color); 
                    box-shadow: 0 30px 60px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.1); 
                    box-sizing: border-box; 
                }

                .header-flex { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
                h1 { font-size: 24px; font-weight: 800; margin: 0; letter-spacing: -0.02em; }
                
                .status-card { background: rgba(255,255,255,0.03); border: 1px solid var(--border-color); border-radius: 18px; padding: 18px; margin-bottom: 24px; }
                .status-badge { display: inline-block; padding: 6px 12px; border-radius: 999px; font-size: 12px; font-weight: 800; text-transform: uppercase; }
                .status-open { background: rgba(22, 163, 74, 0.2); color: #4ade80; border: 1px solid rgba(22, 163, 74, 0.4); }
                .status-closed { background: rgba(220, 38, 38, 0.2); color: #f87171; border: 1px solid rgba(220, 38, 38, 0.4); }

                .section-title { font-size: 14px; font-weight: 800; margin: 24px 0 12px 0; color: #f1f5f9; text-transform: uppercase; letter-spacing: 0.05em; border-bottom: 1px solid var(--border-color); padding-bottom: 8px; display: flex; align-items: center; gap: 8px; }

                .field { display: flex; flex-direction: column; gap: 6px; margin-bottom: 14px; }
                label { font-size: 12px; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; }

                input, textarea { 
                    background: rgba(11, 13, 16, 0.8); 
                    border: 1px solid var(--border-color); 
                    border-radius: 12px; 
                    padding: 13px 15px; 
                    color: #fff; 
                    font-size: 14px; 
                    font-family: var(--font-main); 
                    outline: none; 
                    width: 100%; 
                    box-sizing: border-box; 
                    transition: all 0.2s;
                }
                input:focus, textarea:focus { border-color: var(--accent-red); }
                textarea { resize: vertical; min-height: 80px; }

                .btn-group { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 16px; }
                .btn { border: 0; border-radius: 12px; padding: 14px; font-weight: 700; cursor: pointer; color: #fff; font-family: var(--font-main); transition: all 0.2s; font-size: 14px; box-shadow: 0 4px 12px rgba(0,0,0,0.2); }
                .btn:hover { opacity: 0.95; transform: translateY(-1px); }
                .btn-green { background: var(--accent-green); }
                .btn-red { background: var(--accent-red); }
                .btn-blue { background: var(--accent-blue); width: 100%; }
                .btn-orange { background: var(--accent-orange); width: 100%; }
                .btn-purple { background: #7c3aed; width: 100%; }

                .alert { padding: 14px; border-radius: 12px; font-size: 13px; font-weight: 600; display: none; margin-bottom: 20px; border: 1px solid rgba(255,255,255,0.1); word-break: break-all; }
                
                .nav-links { display: flex; gap: 8px; }
                .nav-link { color: #f87171; text-decoration: none; font-size: 13px; font-weight: 700; background: rgba(220, 38, 38, 0.1); padding: 8px 12px; border-radius: 10px; border: 1px solid rgba(220, 38, 38, 0.2); }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header-flex">
                    <h1>🏆 Gestor do Bolão (D1 SQL)</h1>
                    <div class="nav-links">
                        <a href="/api/painel-addgoal" class="nav-link">⚽ Gols</a>
                        <a href="/api/lista-gols" class="nav-link" style="color:#cbd5e1; background:rgba(255,255,255,0.05); border-color:rgba(255,255,255,0.1);">📋 Acervo</a>
                    </div>
                </div>
                
                <div id="msgBox" class="alert"></div>

                <div class="status-card">
                    <div>Status dos Palpites: <span class="status-badge ${bolaoAberto === "true" ? "status-open" : "status-closed"}">${bolaoAberto === "true" ? "ABERTO" : "FECHADO"}</span></div>
                    <div style="margin-top:10px; font-size:14px;"><strong>Partida / Confronto:</strong> <span style="color:#f4d03f; font-weight:700;">${confrontoAtual}</span></div>
                    <div style="margin-top:6px; font-size:12px; color:var(--text-muted);"><strong>ID do Post Ativo no Canal:</strong> <code style="color:#f87171; font-family:var(--font-code);">${postAtivoId}</code></div>
                </div>

                <div class="section-title">⚡ Controle do Status do Bolão</div>
                <div class="btn-group">
                    <button class="btn btn-green" onclick="alterarStatus('true')">🔓 Abrir Palpites</button>
                    <button class="btn btn-red" onclick="alterarStatus('false')">🔒 Bloquear Palpites</button>
                </div>

                <div class="section-title">👤 1. Editar Pontos do Usuário</div>
                <div class="field">
                    <label>ID do Telegram do Usuário</label>
                    <div style="display:flex; gap:8px;">
                        <input type="text" id="user_id_search" placeholder="Ex: 7717528550">
                        <button class="btn btn-blue" style="width:auto; padding:0 20px;" onclick="buscarUserRanking()">🔍 Buscar</button>
                    </div>
                </div>

                <div id="userEditCard" style="display:none; background:rgba(255,255,255,0.02); border:1px dashed var(--border-color); padding:16px; border-radius:14px; margin-bottom:16px;">
                    <div class="field">
                        <label>Nome do Torcedor</label>
                        <input type="text" id="user_nome_edit">
                    </div>
                    <div class="field">
                        <label>Pontos Totais no Ranking</label>
                        <input type="number" id="user_pontos_edit">
                    </div>
                    <button class="btn btn-green" style="width:100%;" onclick="salvarUserRanking()">💾 Salvar Dados no D1</button>
                </div>

                <div class="section-title">🔗 2. Vincular / Reativar Post do Canal</div>
                <div class="field">
                    <label>ID Numérico da Mensagem no Canal</label>
                    <input type="text" id="vincular_post_id" placeholder="Ex: 1234">
                </div>
                <div class="field">
                    <label>Confronto (Opcional)</label>
                    <input type="text" id="vincular_confronto" value="${confrontoAtual !== "Nenhum no momento" ? confrontoAtual : ""}" placeholder="Ex: Flamengo X Vitória 19h30">
                </div>
                <button class="btn btn-orange" onclick="vincularPostExistente()">🔗 Reativar e Vincular Post no D1</button>

                <div class="section-title">🚀 3. Iniciar Novo Bolão (Postar Foto)</div>
                <div class="field">
                    <label>Confronto / Horário</label>
                    <input type="text" id="init_confronto" placeholder="Ex: FLAMENGO X VASCO 21H00">
                </div>
                <div class="field">
                    <label>FileID da Foto Oficial do Bolão</label>
                    <input type="text" id="init_foto" placeholder="Cole o FileID longo da imagem">
                </div>
                <button class="btn btn-blue" onclick="iniciarBolaoWeb()">🚀 Publicar Nova Postagem no Canal @Flamengo77</button>

                <div class="section-title">🥇 4. Gerenciar Lista de Vencedores Salvos</div>
                <div class="field">
                    <label>Legenda dos Vencedores (Editável)</label>
                    <textarea id="vencedores_texto" placeholder="Ex: 🥇 Torcedor 1 (Ver Palpite)...">${vencedoresTemp}</textarea>
                </div>
                <button class="btn btn-purple" onclick="salvarVencedoresManual()">💾 Gravar Vencedores no D1</button>

                <div class="section-title">🏁 5. Encerrar Bolão e Postar Resultado</div>
                <div class="field">
                    <label>Placar Real do Jogo</label>
                    <input type="text" id="encerrar_placar" placeholder="Ex: 2x1">
                </div>
                <div class="field">
                    <label>FileID da Foto do Resultado (Opcional)</label>
                    <input type="text" id="encerrar_foto" placeholder="Cole o FileID da imagem de encerramento">
                </div>
                <button class="btn btn-red" style="width:100%; margin-top:6px;" onclick="encerrarBolaoWeb()">🏁 Encerrar, Publicar Resultado e Sincronizar Ranking</button>
            </div>

            <script>
                function mostrarAviso(txt, eSucesso) {
                    const box = document.getElementById('msgBox');
                    box.style.display = 'block';
                    box.style.backgroundColor = eSucesso ? '#065f46' : '#991b1b';
                    box.innerText = txt;
                }

                async function alterarStatus(st) {
                    const res = await fetch('/api/bolao-toggle?status=' + st, { method: 'POST' });
                    const data = await res.json();
                    if(data.ok) {
                        mostrarAviso('Status alterado com sucesso!', true);
                        setTimeout(() => location.reload(), 800);
                    }
                }

                async function buscarUserRanking() {
                    const uid = document.getElementById('user_id_search').value.trim();
                    if(!uid) return alert('Digite o ID do usuário!');

                    const res = await fetch('/api/get-user-details?uid=' + uid);
                    const data = await res.json();
                    if(data.ok) {
                        document.getElementById('user_nome_edit').value = data.nome || '';
                        document.getElementById('user_pontos_edit').value = data.pontos || 0;
                        document.getElementById('userEditCard').style.display = 'block';
                        mostrarAviso('Dados do usuário carregados!', true);
                    } else {
                        mostrarAviso('Usuário não encontrado no banco.', false);
                    }
                }

                async function salvarUserRanking() {
                    const uid = document.getElementById('user_id_search').value.trim();
                    const nome = document.getElementById('user_nome_edit').value.trim();
                    const pontos = document.getElementById('user_pontos_edit').value;

                    const res = await fetch('/api/save-user-details', {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({ uid, nome, pontos })
                    });
                    const data = await res.json();
                    if(data.ok) {
                        mostrarAviso('✅ Dados do usuário atualizados no D1!', true);
                    } else {
                        mostrarAviso('❌ Erro ao salvar.', false);
                    }
                }

                async function vincularPostExistente() {
                    const postId = document.getElementById('vincular_post_id').value.trim();
                    const confronto = document.getElementById('vincular_confronto').value.trim();
                    if(!postId) return alert('Digite o ID numérico da mensagem do post no canal!');

                    const res = await fetch('/api/bolao-vincular', {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({ post_id: postId, confronto })
                    });
                    const data = await res.json();
                    if(data.ok) {
                        mostrarAviso('✅ Post ' + postId + ' vinculado e reativado com sucesso!', true);
                        setTimeout(() => location.reload(), 1000);
                    } else {
                        mostrarAviso('❌ Erro ao vincular post.', false);
                    }
                }

                async function iniciarBolaoWeb() {
                    const confronto = document.getElementById('init_confronto').value.trim();
                    const foto = document.getElementById('init_foto').value.trim();
                    if(!confronto || !foto) return alert('Preencha o confronto e o FileID da foto!');

                    mostrarAviso('Publicando bolão no canal...', true);
                    const res = await fetch('/api/bolao-iniciar-web', {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({ confronto, foto })
                    });
                    const data = await res.json();
                    if(data.ok) {
                        mostrarAviso('✅ Bolão publicado no canal com sucesso! ID: ' + data.id, true);
                        setTimeout(() => location.reload(), 1200);
                    } else {
                        mostrarAviso('❌ Erro: ' + (data.error || 'Falha ao publicar'), false);
                    }
                }

                async function salvarVencedoresManual() {
                    const texto = document.getElementById('vencedores_texto').value;
                    const res = await fetch('/api/bolao-vencedores-update', {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({ texto })
                    });
                    const data = await res.json();
                    if(data.ok) {
                        mostrarAviso('✅ Lista de vencedores gravada no D1!', true);
                    } else {
                        mostrarAviso('❌ Erro ao salvar.', false);
                    }
                }

                async function encerrarBolaoWeb() {
                    const placar = document.getElementById('encerrar_placar').value.trim();
                    const foto = document.getElementById('encerrar_foto').value.trim();
                    if(!placar) return alert('Digite o placar final do jogo!');

                    mostrarAviso('Encerrando e processando ranking...', true);
                    const res = await fetch('/api/bolao-encerrar-web', {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({ placar, foto })
                    });
                    const data = await res.json();
                    if(data.ok) {
                        mostrarAviso('✅ Bolão encerrado, postado no canal e ranking sincronizado no D1!', true);
                        setTimeout(() => location.reload(), 1500);
                    } else {
                        mostrarAviso('❌ Erro: ' + (data.error || 'Falha ao encerrar'), false);
                    }
                }
            </script>
        </body>
        </html>
        `;
        return new Response(htmlBolao, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
    }

    // ==========================================================
    // 👤 APIS DE EDIÇÃO INDIVIDUAL DO RANKING NO D1
    // ==========================================================
    else if (url.pathname === "/api/get-user-details" && request.method === "GET") {
        try {
            let uid = url.searchParams.get("uid");
            if (!uid) return new Response(JSON.stringify({ ok: false }), { status: 400, headers: headersCORS });
            uid = Number(uid);

            const user = await env.DB.prepare("SELECT id, nome, pontos FROM usuarios WHERE id = ?").bind(uid).first();
            if (!user) {
                return new Response(JSON.stringify({ ok: false, error: "not_found" }), { status: 404, headers: headersCORS });
            }

            return new Response(JSON.stringify({
                ok: true,
                nome: user.nome || "Torcedor",
                pontos: user.pontos || 0
            }), { status: 200, headers: headersCORS });
        } catch (e) {
            return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: headersCORS });
        }
    }

    else if (url.pathname === "/api/save-user-details" && request.method === "POST") {
        try {
            const body = await request.json();
            const { uid, nome, pontos } = body;

            if (!uid) return new Response(JSON.stringify({ ok: false }), { status: 400, headers: headersCORS });

            await env.DB.prepare(`
                INSERT INTO usuarios (id, nome, pontos, criado_em)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET nome = ?, pontos = ?
            `).bind(Number(uid), nome || "Torcedor", Number(pontos) || 0, Date.now(), nome || "Torcedor", Number(pontos) || 0).run();

            return new Response(JSON.stringify({ ok: true }), { status: 200, headers: headersCORS });
        } catch (e) {
            return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: headersCORS });
        }
    }

    // ==========================================================
    // 🔄 ROTA DE AÇÕES WEB DO BOLÃO
    // ==========================================================
    else if (url.pathname === "/api/bolao-toggle" && request.method === "POST") {
        let st = url.searchParams.get("status") || "false";
        await setConfig(env.DB, "bolao_aberto", st);
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: headersCORS });
    }

    else if (url.pathname === "/api/bolao-vincular" && request.method === "POST") {
        try {
            const body = await request.json();
            const postId = String(body.post_id || "").trim();
            const confronto = String(body.confronto || "").trim();

            if (!postId) return new Response(JSON.stringify({ ok: false, error: "post_id_missing" }), { status: 400, headers: headersCORS });

            await setConfig(env.DB, "postagem_ativa_id", postId);
            await setConfig(env.DB, "bolao_aberto", "true");

            if (confronto) {
                await setConfig(env.DB, "confronto_atual", confronto);
                await setConfig(env.DB, "confronto_" + postId, confronto);
            }

            return new Response(JSON.stringify({ ok: true }), { status: 200, headers: headersCORS });
        } catch (e) {
            return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: headersCORS });
        }
    }

    else if (url.pathname === "/api/bolao-vencedores-update" && request.method === "POST") {
        try {
            const body = await request.json();
            await setConfig(env.DB, "vencedores_temporarios", body.texto || "");
            return new Response(JSON.stringify({ ok: true }), { status: 200, headers: headersCORS });
        } catch (e) {
            return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: headersCORS });
        }
    }

    else if (url.pathname === "/api/bolao-iniciar-web" && request.method === "POST") {
        try {
            const body = await request.json();
            const formatarTimes = (txt) => txt.toLowerCase().replace(/\b\w/g, (l) => l.toUpperCase());
            let infoJogo = formatarTimes(body.confronto.trim());
            let fotoId = body.foto.trim();

            await deleteConfig(env.DB, "postagem_ativa_id");
            await setConfig(env.DB, "vencedores_temporarios", "");

            let confrontoLimpo = infoJogo.replace(/\d{1,2}H\d{0,2}/gi, "").replace(/\d{1,2}:\d{2}/g, "").trim();
            let partesTimes = confrontoLimpo.split(/\s+x\s+/i);
            let timeCasa = partesTimes[0] ? partesTimes[0].trim() : "Time 1";
            let timeFora = partesTimes[1] ? partesTimes[1].trim() : "Time 2";

            let textoLegenda =
                "🏟 <b>BOLÃO DO MENGÃO</b> 🔴⚫\n\n" +
                "🔥 <b>PARTIDA:</b>\n<b>" + infoJogo + "</b>\n\n" +
                "💬 <b>COMO PARTICIPAR:</b>\nClique em <b>“Escrever um comentário”</b> e envie seu palpite.\n\n" +
                "<blockquote expandable>" +
                "📌 <b>LEIA ANTES DE PALPITAR</b>\n\n" +
                "O placar deve seguir exatamente a ordem da partida:\n<b>" + timeCasa + " X " + timeFora + "</b>\n\n" +
                "Exemplos:\n• <b>2x1</b>\n• <b>1x1</b>\n\n" +
                "⚠️ <b>REGRAS:</b> Apenas 1 palpite por usuário. Editou perde a validação. Palpites após o início não contam." +
                "</blockquote>\n\n" +
                "🏆 Vale <b>1 ponto</b> no ranking!";

            await setConfig(env.DB, "confronto_atual", infoJogo);
            await setConfig(env.DB, "bolao_aberto", "true");

            const respostaCanal = await fetch(`https://api.telegram.org/bot${botToken}/sendPhoto`, {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ chat_id: "@Flamengo77", photo: fotoId, caption: textoLegenda, parse_mode: "HTML" })
            });

            const dadosPostagem = await respostaCanal.json();
            if (dadosPostagem.ok && dadosPostagem.result?.message_id) {
                const canalMessageId = String(dadosPostagem.result.message_id);
                await setConfig(env.DB, "postagem_ativa_id", canalMessageId);
                await setConfig(env.DB, "confronto_" + canalMessageId, infoJogo);
                return new Response(JSON.stringify({ ok: true, id: canalMessageId }), { status: 200, headers: headersCORS });
            }
            return new Response(JSON.stringify({ ok: false, error: dadosPostagem.description || "Falha ao enviar para o canal" }), { status: 500, headers: headersCORS });
        } catch (e) {
            return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: headersCORS });
        }
    }

    else if (url.pathname === "/api/bolao-encerrar-web" && request.method === "POST") {
        try {
            const body = await request.json();
            let placar = body.placar.trim();
            let fotoResultadoId = body.foto ? body.foto.trim() : "";
            let msgIdOriginal = await getConfig(env.DB, "postagem_ativa_id");

            if (!msgIdOriginal) {
                return new Response(JSON.stringify({ ok: false, error: "Nenhum bolão ativo encontrado no D1." }), { status: 400, headers: headersCORS });
            }

            let confronto = (await getConfig(env.DB, "confronto_" + msgIdOriginal)) || (await getConfig(env.DB, "confronto_atual")) || "FLAMENGO";

            const { results: vencedores } = await env.DB.prepare(`
                SELECT user_id FROM palpites 
                WHERE postagem_id = ? AND LOWER(TRIM(palpite)) = LOWER(TRIM(?))
            `).bind(msgIdOriginal, placar).all();

            const vencedoresIds = vencedores.map(v => String(v.user_id));

            if (vencedoresIds.length > 0) {
                const placeholders = vencedoresIds.map(() => "?").join(",");
                await env.DB.prepare(`
                    UPDATE usuarios 
                    SET pontos = pontos + 1 
                    WHERE id IN (${placeholders})
                `).bind(...vencedoresIds).run();

                for (const vId of vencedoresIds) {
                    await env.DB.prepare(`
                        INSERT INTO acertos (postagem_id, user_id, confronto, placar, resgatado, resgatado_em)
                        VALUES (?, ?, ?, ?, 1, ?)
                        ON CONFLICT(postagem_id, user_id) DO UPDATE SET resgatado = 1, resgatado_em = excluded.resgatado_em
                    `).bind(msgIdOriginal, Number(vId), confronto, placar, Date.now()).run();
                }
            }

            await setConfig(env.DB, "vencedores_ids_" + msgIdOriginal, JSON.stringify(vencedoresIds));
            let vencedoresFinal = (await getConfig(env.DB, "vencedores_temporarios")) || (vencedoresIds.length > 0 ? `🎉 ${vencedoresIds.length} torcedor(es) acertaram o placar!` : "Nenhum vencedor registrado.");

            let legendaResultado = `🏆 <b>RESULTADO DO BOLÃO</b> 🏆\n\n⚽ Jogo: <b>${confronto}</b>\n📊 Resultado: <b>${placar}</b>\n\n🥇 Ganhador(es):\n${vencedoresFinal}\n\n🎁 Resgate seu ponto no botão abaixo!`;
            let tecladoResgate = [[{ text: "🥇 RESGATAR MEU PONTO", url: "https://t.me/FlamengoGolsBot?start=resgatar_" + msgIdOriginal }]];

            if (fotoResultadoId) {
                await fetch(`https://api.telegram.org/bot${botToken}/sendPhoto`, {
                    method: "POST", headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ chat_id: "@Flamengo77", photo: fotoResultadoId, caption: legendaResultado, parse_mode: "HTML", reply_markup: { inline_keyboard: tecladoResgate } })
                });
            } else {
                await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                    method: "POST", headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ chat_id: "@Flamengo77", text: legendaResultado, reply_to_message_id: Number(msgIdOriginal), parse_mode: "HTML", disable_web_page_preview: true, reply_markup: { inline_keyboard: tecladoResgate } })
                });
            }

            await setConfig(env.DB, "resultado_oficial_" + msgIdOriginal, placar);
            await setConfig(env.DB, "bolao_encerrado_em_" + msgIdOriginal, String(Date.now()));
            await setConfig(env.DB, "bolao_aberto", "false");
            await setConfig(env.DB, "vencedores_temporarios", "");
            await deleteConfig(env.DB, "postagem_ativa_id");

            return new Response(JSON.stringify({ ok: true }), { status: 200, headers: headersCORS });
        } catch (e) {
            return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: headersCORS });
        }
    }

    // ==========================================================
    // 🖥️ PAINEL VISUAL DE GOLS: /api/painel-addgoal
    // ==========================================================
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

                .nav-links { display: flex; gap: 8px; margin-bottom: 24px; }
                .nav-link { 
                    display: inline-flex; 
                    align-items: center;
                    gap: 6px;
                    color: #f87171; 
                    font-size: 13px; 
                    font-weight: 700; 
                    text-decoration: none; 
                    padding: 8px 14px;
                    background: rgba(220, 38, 38, 0.1);
                    border: 1px solid rgba(220, 38, 38, 0.2);
                    border-radius: 12px;
                    transition: all 0.2s ease;
                }
                .nav-link:hover { background: rgba(220, 38, 38, 0.2); transform: translateY(-1px); }

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
                <p id="panelSubtitle">Preencha os campos abaixo para injetar no Banco D1 SQL.</p>
                
                <div class="nav-links">
                    <a href="/api/lista-gols" class="nav-link">📋 Lista Completa</a>
                    <a href="/api/painel-bolao" class="nav-link" style="color:#4ade80; background:rgba(22,163,74,0.1); border-color:rgba(22,163,74,0.2);">🏆 Gestor do Bolão</a>
                </div>
                
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
                    <p style="font-size:13px; color:#a1a1aa; margin:0 0 12px 0;">Confira os dados antes de gravar no D1 SQL:</p>
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
                        btnSubmit.innerText = "💾 Salvar Alterações no D1";
                    } else {
                        panelTitle.innerText = "⚽ Adicionar Novo Gol";
                        panelSubtitle.innerText = "Preencha os campos abaixo para injetar no Banco D1 SQL.";
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
                            alertBox.innerText = '✅ Processado com sucesso! Registro salvo no D1 com o ID: ' + data.id;
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

    // ==========================================================
    // 📋 LISTA DE GOLS COMPLETA (ORDEM CORRETA DO MAIS NOVO PRO MAIS ANTIGO)
    // ==========================================================
    else if (url.pathname === "/api/lista-gols" && request.method === "GET") {
        try {
            let queryText = url.searchParams.get("q") || "";
            let gols = [];

            if (queryText) {
                const searchParam = `%${queryText.trim()}%`;
                const { results } = await env.DB.prepare(`
                    SELECT * FROM gols 
                    WHERE jogo LIKE ? OR autor LIKE ? OR assistencia LIKE ? OR campeonato LIKE ? OR fase LIKE ?
                    ORDER BY CAST(criado_em AS INTEGER) DESC, CAST(id AS INTEGER) DESC
                `).bind(searchParam, searchParam, searchParam, searchParam, searchParam).all();
                gols = results;
            } else {
                const { results } = await env.DB.prepare(`
                    SELECT * FROM gols 
                    ORDER BY CAST(criado_em AS INTEGER) DESC, CAST(id AS INTEGER) DESC 
                    LIMIT 30
                `).all();
                gols = results;
            }

            const countRow = await env.DB.prepare("SELECT COUNT(*) as total FROM gols").first();
            const totalEncontrados = queryText ? gols.length : (countRow?.total || 0);

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

                    <div class="info-txt">💡 Exibindo apenas os 30 gols mais recentes para economizar dados. Use a barra de busca acima para varrer o acervo completo.</div>
                </div>

                <div id="deleteModal" class="modal-overlay">
                    <div class="modal-content">
                        <h3 class="modal-title">⚠️ Excluir Gol Permanentemente?</h3>
                        <p id="deleteModalText" style="font-size:14px; color:#e4e4e7; margin:0; line-height:1.5;"></p>
                        <p style="font-size:12px; color:#f87171; font-weight:700; margin:10px 0 0 0;">🚨 Essa ação é irreversível e removerá o gol do robô!</p>
                        <div class="modal-buttons">
                            <button class="btn-modal-cancel" onclick="fecharModalDelecao()">Cancelar</button>
                            <button class="btn-modal-delete" id="btnConfirmDelete" onclick="executarExclusaoDefinitiva()">🗑️ Apagar do D1</button>
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
                            btn.innerText = '🗑️ Apagar do D1';
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

    // ==========================================================
    // ⚙️ MOTOR DO BOLÃO: /api/processar-bolao
    // ==========================================================
    else if (url.pathname === "/api/processar-bolao" && request.method === "POST") {
        try {
            const data = await request.json();
            const postId = String(data.post_id || "");
            const userId = Number(data.user_id || 0);
            const textoOriginal = String(data.texto_bruto || "").trim();

            let bolaoStatus = await getConfig(env.DB, "bolao_aberto");
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

            const palpiteExistente = await env.DB.prepare("SELECT palpite FROM palpites WHERE postagem_id = ? AND user_id = ?").bind(postId, userId).first();
            if (palpiteExistente) {
                await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                    method: "POST", headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ 
                        chat_id: data.chat_id, 
                        reply_to_message_id: Number(data.message_id), 
                        parse_mode: "Markdown", 
                        text: `⚠️ *Você já enviou um palpite!*\n\n📌 Seu palpite registrado: *${palpiteExistente.palpite}*\n\n• Não é permitido alterar ou enviar múltiplos palpites.` 
                    })
                });
                return new Response(JSON.stringify({ ok: false, error: "duplicado" }), { status: 200, headers: headersCORS });
            }

            let limpo = textoOriginal.replace(/×/g, "x").replace(/X/g, "x").replace(/–|—/g, "-").replace(/\s+/g, " ").trim();
            let direto = limpo.match(/(?:^|\D)(\d{1,2})\s*(?:x|-|a)\s*(\d{1,2})(?:\D|$)/i);
            
            let casa = "", fora = "", valido = false;
            if (direto) { 
                casa = direto[1]; fora = direto[2]; valido = true; 
            } else {
                let semHorario = limpo.replace(/\b\d{1,2}\s*h\s*\d{0,2}\b/gi, " ").replace(/\b\d{1,2}:\d{2}\b/g, " ").replace(/\s+/g, " ").trim();
                let comTimes = semHorario.match(/(?:^|[\s.,;:!?])([A-Za-zÀ-ÿ.' -]{2,40})\s+(\d{1,2})\s+([A-Za-zÀ-ÿ.' -]{2,40})\s+(\d{1,2})(?:$|[\s.,;:!?])/i);
                if (comTimes) { 
                    casa = comTimes[2]; fora = comTimes[4]; valido = true; 
                } else {
                    let numeros = semHorario.match(/\b\d{1,2}\b/g);
                    if (numeros && numeros.length === 2) { casa = numeros[0]; fora = numeros[1]; valido = true; }
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

            await env.DB.prepare(`
                INSERT INTO usuarios (id, nome, criado_em)
                VALUES (?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET nome = ?
            `).bind(userId, data.first_name || "Torcedor", Date.now(), data.first_name || "Torcedor").run();

            await env.DB.prepare(`
                INSERT INTO palpites (postagem_id, user_id, palpite, criado_em)
                VALUES (?, ?, ?, ?)
            `).bind(postId, userId, palpiteFinal, Date.now()).run();

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

    // ==========================================================
    // 🗑️ ROTA DE AÇÃO: /api/deletegoal
    // ==========================================================
    else if (url.pathname === "/api/deletegoal" && request.method === "DELETE") {
        try {
            const id = url.searchParams.get("id");
            if (!id) return new Response(JSON.stringify({ ok: false, error: "id_missing" }), { status: 400, headers: headersCORS });

            await env.DB.prepare("DELETE FROM gols WHERE id = ?").bind(String(id)).run();
            return new Response(JSON.stringify({ ok: true, mensagem: "Excluído com sucesso do D1." }), { status: 200, headers: headersCORS });
        } catch (err) {
            return new Response(JSON.stringify({ ok: false, error: err.message }), { status: 500, headers: headersCORS });
        }
    }

    // ==========================================================
    // 🔍 AUXILIAR DE BUSCA: /api/getgoal
    // ==========================================================
    else if (url.pathname === "/api/getgoal" && request.method === "GET") {
        try {
            const id = url.searchParams.get("id");
            if (!id) return new Response(JSON.stringify({ ok: false, error: "id_missing" }), { status: 400, headers: headersCORS });
            
            const gol = await env.DB.prepare("SELECT * FROM gols WHERE id = ?").bind(String(id)).first();
            if (!gol) return new Response(JSON.stringify({ ok: false, error: "not_found" }), { status: 404, headers: headersCORS });
            
            return new Response(JSON.stringify({ ok: true, gol }), { status: 200, headers: headersCORS });
        } catch (e) {
            return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: headersCORS });
        }
    }

    // ==========================================================
    // ⚡ AÇÃO INTEGRADA DA API: /api/addgoal-action
    // ==========================================================
    else if (url.pathname === "/api/addgoal-action" && request.method === "POST") {
        try {
            const body = await request.json();
            if (String(body.admin_id) !== "7717528550") return new Response(JSON.stringify({ ok: false, error: "Acesso Negado." }), { status: 401, headers: headersCORS });

            const isEditing = body.id && body.id.trim() !== "";
            const goalId = isEditing ? body.id.trim() : String(Date.now());

            await env.DB.prepare(`
                INSERT INTO gols (id, file_id, jogo, autor, assistencia, campeonato, fase, criado_em)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET 
                    file_id = ?, jogo = ?, autor = ?, assistencia = ?, campeonato = ?, fase = ?
            `).bind(
                goalId, body.file_id.trim(), body.jogo.trim(), body.autor.trim(), body.assistencia.trim(), body.campeonato.trim(), body.fase.trim(), Date.now(),
                body.file_id.trim(), body.jogo.trim(), body.autor.trim(), body.assistencia.trim(), body.campeonato.trim(), body.fase.trim()
            ).run();

            try {
                const CANAL_BACKUP = "-1003703318973";
                const txtStatus = isEditing ? "📝 Gol editado e modificado" : "📌 Novo gol adicionado";
                await fetch(`https://api.telegram.org/bot${botToken}/sendVideo`, {
                    method: "POST", headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        chat_id: CANAL_BACKUP, video: body.file_id.trim(),
                        caption: `📌 <b>${txtStatus} via Painel Web</b>\n\n🆔 <code>${goalId}</code>\n⚽ ${body.jogo.trim()}\n\n#⃣ Autor: ${body.autor.trim()}\n🅰 Assistência: ${body.assistencia.trim()}\n🏆 ${body.campeonato.trim()} - ${body.fase.trim()}`,
                        parse_mode: "HTML"
                    })
                });
            } catch (e) {}

            return new Response(JSON.stringify({ ok: true, id: goalId }), { status: 200, headers: headersCORS });
        } catch (err) {
            return new Response(JSON.stringify({ ok: false, error: err.message }), { status: 500, headers: headersCORS });
        }
    }

    return new Response(JSON.stringify({ erro: "Rota não encontrada" }), { status: 404, headers: headersCORS });
}
