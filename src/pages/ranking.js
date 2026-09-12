function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function iniciais(nome) {
  const partes = String(nome || "Torcedor").trim().split(/\s+/).filter(Boolean);
  return (partes.slice(0, 2).map(p => p[0]).join("") || "T").toUpperCase();
}

function formatarData(ts) {
  const n = Number(ts || 0);
  if (!n) return "Data não registrada";
  try {
    return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(n));
  } catch {
    return "Data não registrada";
  }
}

function avatar(usuario, classe = "") {
  const nome = usuario?.nome || "Torcedor";
  return `<span class="avatar ${classe}">
    <img src="/ranking/avatar/${encodeURIComponent(String(usuario.id))}" alt="Foto de ${esc(nome)}" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='grid'">
    <span class="avatar-fallback" style="display:none">${esc(iniciais(nome))}</span>
  </span>`;
}

function medalha(index) {
  if (index === 0) return "🥇";
  if (index === 1) return "🥈";
  if (index === 2) return "🥉";
  return `#${index + 1}`;
}

function podioCard(usuario, index) {
  if (!usuario) return '<div class="pod placeholder"></div>';
  const classe = index === 0 ? "first" : index === 1 ? "second" : "third";
  return `<article class="pod ${classe}">
    <span class="medal">${medalha(index)}</span>
    ${avatar(usuario, "pod-avatar")}
    <strong>${esc(usuario.nome || "Torcedor")}</strong>
    <span class="pod-points">${Number(usuario.pontos || 0)} pts</span>
  </article>`;
}

function historicoMarkup(partidas = []) {
  if (!partidas.length) return '<div class="empty-history">Nenhuma partida detalhada registrada ainda.</div>';
  return partidas.map((p) => `<article class="match-row">
    <div class="match-icon">✓</div>
    <div class="match-copy">
      <strong>${esc(p.confronto || "Partida")}</strong>
      <span>${esc(formatarData(p.resgatado_em))}</span>
    </div>
    <div class="match-score"><small>Placar</small><b>${esc(p.placar || "—")}</b></div>
  </article>`).join("");
}

export async function renderRankingAvatar(request, env) {
  const url = new URL(request.url);
  const match = url.pathname.match(/^\/ranking\/avatar\/(\d+)$/);
  if (!match) return new Response("Not found", { status: 404 });

  const userId = Number(match[1]);
  const user = await env.DB.prepare("SELECT nome, foto_file_id FROM usuarios WHERE id = ?").bind(userId).first();
  if (!user) return new Response("Not found", { status: 404 });

  const token = env.TELEGRAM_TOKEN;
  let fileId = user.foto_file_id || "";

  try {
    if (token) {
      if (!fileId) {
        const photosRes = await fetch(`https://api.telegram.org/bot${token}/getUserProfilePhotos?user_id=${userId}&limit=1`);
        const photos = await photosRes.json();
        if (photos?.ok && photos.result?.photos?.length) {
          const sizes = photos.result.photos[0] || [];
          fileId = sizes[sizes.length - 1]?.file_id || sizes[0]?.file_id || "";
          if (fileId) {
            await env.DB.prepare("UPDATE usuarios SET foto_file_id = ? WHERE id = ?").bind(fileId, userId).run();
          }
        }
      }

      if (fileId) {
        let fileRes = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${encodeURIComponent(fileId)}`);
        let fileData = await fileRes.json();

        if (!fileData?.ok) {
          const photosRes = await fetch(`https://api.telegram.org/bot${token}/getUserProfilePhotos?user_id=${userId}&limit=1`);
          const photos = await photosRes.json();
          if (photos?.ok && photos.result?.photos?.length) {
            const sizes = photos.result.photos[0] || [];
            const refreshed = sizes[sizes.length - 1]?.file_id || sizes[0]?.file_id || "";
            if (refreshed) {
              fileId = refreshed;
              await env.DB.prepare("UPDATE usuarios SET foto_file_id = ? WHERE id = ?").bind(fileId, userId).run();
              fileRes = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${encodeURIComponent(fileId)}`);
              fileData = await fileRes.json();
            }
          }
        }

        if (fileData?.ok && fileData.result?.file_path) {
          const imageRes = await fetch(`https://api.telegram.org/file/bot${token}/${fileData.result.file_path}`);
          if (imageRes.ok) {
            return new Response(imageRes.body, {
              status: 200,
              headers: {
                "Content-Type": imageRes.headers.get("Content-Type") || "image/jpeg",
                "Cache-Control": "public, max-age=1800",
                "X-Content-Type-Options": "nosniff"
              }
            });
          }
        }
      }
    }
  } catch (error) {
    console.error("Erro ao carregar avatar", userId, error);
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><defs><linearGradient id="g" x1="0" x2="1"><stop stop-color="#cc1414"/><stop offset="1" stop-color="#7f1d1d"/></linearGradient></defs><circle cx="60" cy="60" r="60" fill="url(#g)"/><text x="60" y="72" text-anchor="middle" font-family="Arial,sans-serif" font-size="38" font-weight="800" fill="#fff">${esc(iniciais(user.nome))}</text></svg>`;
  return new Response(svg, { status: 200, headers: { "Content-Type": "image/svg+xml; charset=utf-8", "Cache-Control": "public, max-age=600" } });
}

export async function renderRankingPage(request, env) {
  try {
    const { results: ranking = [] } = await env.DB.prepare(`
      SELECT id, nome, pontos
      FROM usuarios
      WHERE pontos > 0
      ORDER BY pontos DESC, nome COLLATE NOCASE ASC, id ASC
    `).all();

    const { results: acertos = [] } = await env.DB.prepare(`
      SELECT user_id, postagem_id, confronto, placar, resgatado_em
      FROM acertos
      ORDER BY CAST(resgatado_em AS INTEGER) DESC, id DESC
    `).all();

    const porUsuario = new Map();
    for (const acerto of acertos) {
      const key = String(acerto.user_id);
      if (!porUsuario.has(key)) porUsuario.set(key, []);
      porUsuario.get(key).push(acerto);
    }

    const topThree = [ranking[0], ranking[1], ranking[2]];
    const podium = `<div class="podium-slot side">${podioCard(topThree[1], 1)}</div><div class="podium-slot center">${podioCard(topThree[0], 0)}</div><div class="podium-slot side">${podioCard(topThree[2], 2)}</div>`;

    const linhas = ranking.length ? ranking.map((u, i) => `<article class="player-row searchable" data-search="${esc(String(u.nome || "").toLowerCase())}">
      <div class="left">
        <span class="position">${medalha(i)}</span>
        ${avatar(u, "row-avatar")}
        <div class="player-info"><strong>${esc(u.nome || "Torcedor")}</strong></div>
      </div>
      <div class="score-box"><strong>${Number(u.pontos || 0)}</strong><span>pts</span></div>
    </article>`).join("") : '<div class="empty">Ainda não há jogadores pontuando.</div>';

    const acertosCards = ranking.length ? ranking.map((u, i) => {
      const historico = porUsuario.get(String(u.id)) || [];
      return `<article class="history-card searchable" data-search="${esc(String(u.nome || "").toLowerCase())}">
        <header>
          <div class="history-user">
            ${avatar(u, "history-avatar")}
            <div><strong>${esc(u.nome || "Torcedor")}</strong><span>ID ${esc(String(u.id))} • ${i + 1}º no ranking</span></div>
          </div>
          <div class="history-count"><b>${historico.length}</b><span>acertos</span></div>
        </header>
        <div class="history-list">${historicoMarkup(historico)}</div>
      </article>`;
    }).join("") : '<div class="empty">Nenhum histórico disponível.</div>';

    const totalJogadores = ranking.length;
    const totalPontos = ranking.reduce((s, u) => s + Number(u.pontos || 0), 0);
    const totalAcertos = acertos.length;
    const lider = ranking[0]?.nome || "—";

    const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#0b0c0f"><title>Ranking • Gols Flamengo</title><style>
:root{--bg:#0b0c0f;--card:#121419;--card2:#171a21;--input:#1b1f27;--border:#282d37;--text:#f7f7f8;--muted:#969daa;--red:#cc1414;--gold:#f2c94c;--shadow:0 18px 50px rgba(0,0,0,.34)}*{box-sizing:border-box}body{margin:0;min-height:100vh;background:linear-gradient(180deg,#111216 0,#0b0c0f 36%,#090a0d 100%);color:var(--text);font-family:Inter,system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}.wrap{width:min(100%,760px);margin:auto;padding:22px 14px 60px}.brandbar{display:flex;align-items:center;justify-content:space-between;margin-bottom:18px}.brand{display:flex;align-items:center;gap:10px}.logo{width:43px;height:43px;border-radius:14px;background:linear-gradient(145deg,#d91d1d,#6d0c0c);display:grid;place-items:center;font-size:20px;box-shadow:0 10px 28px rgba(204,20,20,.22)}.brand strong{display:block;font-size:14px}.brand span{display:block;color:var(--muted);font-size:10px;margin-top:2px}.refresh{color:white;text-decoration:none;background:var(--card2);border:1px solid var(--border);padding:9px 12px;border-radius:11px;font-size:12px;font-weight:800}.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:14px}.stat{background:var(--card);border:1px solid var(--border);border-radius:18px;padding:14px 12px;text-align:center}.stat i{display:block;font-style:normal;font-size:18px}.stat b{display:block;font-size:22px;margin-top:5px}.stat span{display:block;color:var(--muted);font-size:10px;margin-top:3px}.panel{background:var(--card);border:1px solid var(--border);border-radius:22px;padding:14px;box-shadow:var(--shadow)}.panel-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px}.panel-head h1{font-size:19px;margin:0}.panel-head p{margin:4px 0 0;color:var(--muted);font-size:11px}.live{color:#53dd86;font-size:11px;font-weight:800}.podium{display:grid;grid-template-columns:1fr 1.08fr 1fr;gap:8px;align-items:end;margin:12px 0 18px}.pod{position:relative;text-align:center;background:var(--card2);border:1px solid var(--border);border-radius:17px;padding:14px 8px 12px}.center .pod{min-height:184px;border-color:rgba(242,201,76,.45);background:linear-gradient(180deg,rgba(242,201,76,.08),var(--card2) 38%)}.side .pod{min-height:162px}.pod.placeholder{visibility:hidden}.medal{position:absolute;right:7px;top:6px;font-size:22px}.avatar{display:grid;place-items:center;overflow:hidden;border-radius:50%;background:linear-gradient(145deg,#262b35,#171a20);flex:0 0 auto}.avatar img,.avatar-fallback{width:100%;height:100%;object-fit:cover;place-items:center}.pod-avatar{width:60px;height:60px;margin:6px auto 8px;border:2px solid rgba(255,255,255,.12)}.center .pod-avatar{width:72px;height:72px;border-color:var(--gold)}.pod strong{display:block;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.pod-points{display:block;color:var(--muted);font-size:11px;margin-top:5px}.filters{display:flex;gap:6px;margin-bottom:10px}.filter{flex:1;border:0;border-radius:10px;padding:9px;background:var(--input);color:var(--muted);font-size:11px;font-weight:800;cursor:pointer}.filter.active{background:var(--red);color:white}.search{display:flex;align-items:center;background:var(--input);border:1px solid var(--border);border-radius:12px;padding:0 11px;margin-bottom:10px}.search input{width:100%;height:40px;border:0;background:transparent;color:white;outline:none}.player-row{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:11px 9px;border-top:1px solid #20242c}.player-row:first-child{border-top:0}.left{display:flex;align-items:center;gap:10px;min-width:0}.position{width:34px;text-align:center;font-weight:900;font-size:14px}.row-avatar{width:42px;height:42px;border:1px solid var(--border)}.player-info{min-width:0}.player-info strong{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:13px}.score-box{text-align:right}.score-box strong{font-size:19px}.score-box span{display:block;color:var(--muted);font-size:9px}.tabs{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin:14px 0}.tab{border:1px solid var(--border);background:var(--card2);color:var(--muted);border-radius:12px;padding:11px;font-weight:900;cursor:pointer}.tab.active{background:var(--red);border-color:var(--red);color:white}.tab-panel{display:none}.tab-panel.active{display:block}.history-card{background:var(--card);border:1px solid var(--border);border-radius:18px;margin:10px 0;overflow:hidden}.history-card header{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:13px;border-bottom:1px solid #20242c}.history-user{display:flex;align-items:center;gap:10px;min-width:0}.history-avatar{width:45px;height:45px;border:1px solid var(--border)}.history-user strong{display:block;font-size:13px}.history-user span{display:block;color:var(--muted);font-size:9px;margin-top:3px}.history-count{text-align:right}.history-count b{display:block;font-size:17px}.history-count span{display:block;color:var(--muted);font-size:9px}.history-list{padding:10px}.match-row{display:grid;grid-template-columns:30px minmax(0,1fr) auto;gap:9px;align-items:center;background:#0d0f13;border:1px solid #20242c;border-radius:12px;padding:10px;margin:7px 0}.match-icon{width:28px;height:28px;border-radius:9px;background:rgba(83,221,134,.1);color:#53dd86;display:grid;place-items:center;font-weight:900}.match-copy{min-width:0}.match-copy strong{display:block;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.match-copy span{display:block;color:var(--muted);font-size:9px;margin-top:3px}.match-score{text-align:right}.match-score small{display:block;color:var(--muted);font-size:8px}.match-score b{font-size:12px}.empty,.empty-history{text-align:center;color:var(--muted);padding:24px;font-size:12px}.footer{text-align:center;color:#656b75;font-size:10px;margin-top:18px}@media(max-width:480px){.wrap{padding:14px 9px 40px}.stats{gap:5px}.stat{padding:11px 7px}.stat b{font-size:19px}.panel{padding:10px;border-radius:18px}.podium{gap:5px}.pod{padding:12px 5px 10px}.side .pod{min-height:150px}.center .pod{min-height:171px}.pod-avatar{width:52px;height:52px}.center .pod-avatar{width:64px;height:64px}.pod strong{font-size:11px}.player-row{padding:10px 4px}.row-avatar{width:38px;height:38px}.brand span{display:none}}
</style></head><body><main class="wrap"><div class="brandbar"><div class="brand"><div class="logo">🔴⚫</div><div><strong>Gols Flamengo</strong><span>Bolão oficial da comunidade</span></div></div><a class="refresh" href="/ranking">↻ Atualizar</a></div><section class="stats"><div class="stat"><i>👥</i><b>${totalJogadores}</b><span>Jogadores</span></div><div class="stat"><i>🏆</i><b>${totalPontos}</b><span>Pontos</span></div><div class="stat"><i>🎯</i><b>${totalAcertos}</b><span>Acertos</span></div></section><div class="tabs"><button class="tab active" data-tab="ranking">🏆 Pontuação</button><button class="tab" data-tab="acertos">🎯 Acertos</button></div><section id="ranking" class="tab-panel active"><div class="panel"><div class="panel-head"><div><h1>Classificação</h1><p>Líder atual: <b style="color:#ef4444">${esc(lider)}</b></p></div><span class="live">● Ao vivo</span></div><div class="podium">${podium}</div><div class="filters"><button class="filter active" data-filter="todos">📋 Todos</button><button class="filter" data-filter="top10">🔥 Top 10</button></div><label class="search">🔎<input id="search-ranking" placeholder="Buscar jogador..."></label><div id="ranking-list">${linhas}</div></div></section><section id="acertos" class="tab-panel"><div class="panel"><div class="panel-head"><div><h1>Partidas acertadas</h1><p>Histórico detalhado por usuário</p></div><span class="live">${totalAcertos} registros</span></div><label class="search">🔎<input id="search-acertos" placeholder="Buscar por nome ou ID..."></label><div id="acertos-list">${acertosCards}</div></div></section><div class="footer">Gols Flamengo • Cloudflare Worker + D1</div></main><script>
const tabs=document.querySelectorAll('.tab'),panels=document.querySelectorAll('.tab-panel');tabs.forEach(btn=>btn.addEventListener('click',()=>{tabs.forEach(x=>x.classList.remove('active'));panels.forEach(x=>x.classList.remove('active'));btn.classList.add('active');document.getElementById(btn.dataset.tab).classList.add('active')}));
let filtro='todos';const filters=document.querySelectorAll('.filter');function aplicarRanking(){const q=document.getElementById('search-ranking').value.trim().toLowerCase();const rows=[...document.querySelectorAll('#ranking-list .searchable')];rows.forEach((el,i)=>{const match=el.dataset.search.includes(q);const top=filtro==='todos'||i<10;el.style.display=match&&top?'flex':'none'})}filters.forEach(b=>b.addEventListener('click',()=>{filters.forEach(x=>x.classList.remove('active'));b.classList.add('active');filtro=b.dataset.filter;aplicarRanking()}));document.getElementById('search-ranking').addEventListener('input',aplicarRanking);document.getElementById('search-acertos').addEventListener('input',e=>{const q=e.target.value.trim().toLowerCase();document.querySelectorAll('#acertos-list .searchable').forEach(el=>{el.style.display=el.textContent.toLowerCase().includes(q)||el.dataset.search.includes(q)?'block':'none'})});
</script></body></html>`;

    return new Response(html, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
        "Content-Security-Policy": "default-src 'self'; img-src 'self' data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'"
      }
    });
  } catch (error) {
    console.error("Erro ao renderizar ranking", error);
    return new Response("Não foi possível carregar o ranking agora.", { status: 500, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
}
