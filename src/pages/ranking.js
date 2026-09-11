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

function avatarMarkup(usuario, classe = "") {
  const nome = usuario?.nome || "Torcedor";
  const fallback = `<span class="avatar-fallback ${classe}">${esc(iniciais(nome))}</span>`;
  if (!usuario?.foto_url) return fallback;

  return `<span class="avatar-wrap ${classe}">
    <img src="${esc(usuario.foto_url)}" alt="Foto de ${esc(nome)}" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.display='none';this.nextElementSibling.style.display='grid'">
    <span class="avatar-fallback" style="display:none">${esc(iniciais(nome))}</span>
  </span>`;
}

function formatarData(ts) {
  const n = Number(ts || 0);
  if (!n) return "Data não registrada";
  try {
    return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", year: "numeric" })
      .format(new Date(n)).replace(" de ", " ").replace(" de ", " ");
  } catch {
    return "Data não registrada";
  }
}

function cardPodio(usuario, classe, medalha, posicao) {
  if (!usuario) return '<div class="pod placeholder"></div>';
  return `<article class="pod ${classe}">
    <div class="pod-shine"></div>
    <div class="medal">${medalha}</div>
    <div class="pod-position">${posicao}º lugar</div>
    ${avatarMarkup(usuario, "pod-avatar")}
    <div class="pod-name">${esc(usuario.nome || "Torcedor")}</div>
    <div class="pod-points"><strong>${Number(usuario.pontos || 0)}</strong><span>pontos</span></div>
    <div class="pod-wins">${Number(usuario.acertos_salvos || 0)} acerto(s) registrado(s)</div>
  </article>`;
}

function historicoItens(acertos = []) {
  if (!acertos.length) {
    return '<div class="empty-history">Nenhuma partida detalhada registrada ainda.</div>';
  }

  return acertos.map((a, i) => `
    <article class="match-card">
      <div class="match-status">✓</div>
      <div class="match-content">
        <div class="match-topline">
          <span class="match-index">ACERTO ${String(i + 1).padStart(2, "0")}</span>
          <span class="match-date">${esc(formatarData(a.resgatado_em))}</span>
        </div>
        <h4>${esc(a.confronto || "Partida")}</h4>
        <div class="match-score-row">
          <span>Placar acertado</span>
          <strong>${esc(a.placar || "Correto")}</strong>
        </div>
      </div>
    </article>`).join("");
}

export async function renderRankingPage(request, env) {
  try {
    const { results: ranking = [] } = await env.DB.prepare(`
      SELECT
        u.id,
        u.nome,
        u.pontos,
        u.foto_url,
        COUNT(a.id) AS acertos_salvos
      FROM usuarios u
      LEFT JOIN acertos a ON a.user_id = u.id
      WHERE u.pontos > 0
      GROUP BY u.id, u.nome, u.pontos, u.foto_url
      ORDER BY u.pontos DESC, u.nome COLLATE NOCASE ASC, u.id ASC
    `).all();

    const { results: acertos = [] } = await env.DB.prepare(`
      SELECT a.user_id, a.confronto, a.placar, a.resgatado_em
      FROM acertos a
      INNER JOIN usuarios u ON u.id = a.user_id
      WHERE u.pontos > 0
      ORDER BY CAST(a.resgatado_em AS INTEGER) DESC, a.id DESC
    `).all();

    const porUsuario = new Map();
    for (const a of acertos) {
      const k = String(a.user_id);
      if (!porUsuario.has(k)) porUsuario.set(k, []);
      porUsuario.get(k).push(a);
    }

    const podium =
      cardPodio(ranking[1], "second", "🥈", 2) +
      cardPodio(ranking[0], "first", "🥇", 1) +
      cardPodio(ranking[2], "third", "🥉", 3);

    const rankingRows = ranking.length ? ranking.map((u, i) => {
      const hist = porUsuario.get(String(u.id)) || [];
      return `<article class="rank-row" data-name="${esc(String(u.nome || "").toLowerCase())}">
        <div class="rank-main">
          <div class="rank-number ${i < 3 ? `top-${i + 1}` : ""}">${i + 1}</div>
          ${avatarMarkup(u, "rank-avatar")}
          <div class="rank-user">
            <strong>${esc(u.nome || "Torcedor")}</strong>
            <span>${Number(u.acertos_salvos || 0)} partida(s) no histórico</span>
          </div>
          <div class="rank-score"><strong>${Number(u.pontos || 0)}</strong><span>pts</span></div>
          <button class="history-toggle" type="button" aria-label="Ver partidas" onclick="toggleHistory(this)">⌄</button>
        </div>
        <div class="inline-history">
          <div class="inline-history-inner">
            <div class="inline-head"><div><span>HISTÓRICO DO TORCEDOR</span><h3>Partidas acertadas</h3></div><b>${hist.length}</b></div>
            <div class="match-grid">${historicoItens(hist)}</div>
          </div>
        </div>
      </article>`;
    }).join("") : '<div class="empty-state">Ainda não há pontuações no ranking.</div>';

    const historyGroups = ranking.map((u, i) => {
      const hist = porUsuario.get(String(u.id)) || [];
      return `<section class="player-history" data-name="${esc(String(u.nome || "").toLowerCase())}">
        <div class="player-history-head">
          <div class="player-ident">
            ${avatarMarkup(u, "history-avatar")}
            <div><span>${i + 1}º no ranking</span><h3>${esc(u.nome || "Torcedor")}</h3></div>
          </div>
          <div class="player-total"><strong>${hist.length}</strong><span>acertos salvos</span></div>
        </div>
        <div class="match-grid">${historicoItens(hist)}</div>
      </section>`;
    }).join("");

    const totalTorcedores = ranking.length;
    const totalPontos = ranking.reduce((s, u) => s + Number(u.pontos || 0), 0);
    const totalAcertos = ranking.reduce((s, u) => s + Number(u.acertos_salvos || 0), 0);
    const lider = ranking[0]?.nome || "—";

    const html = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#07080a">
<title>Ranking Oficial • Gols Flamengo</title>
<style>
:root{--bg:#07080a;--surface:#0f1116;--surface2:#151820;--surface3:#1a1e27;--line:#252a35;--line2:#303644;--text:#f7f8fa;--muted:#969dab;--muted2:#6f7685;--red:#ed1b2f;--red2:#9f0d1b;--gold:#f4c24e;--silver:#c9ced7;--bronze:#c8834b;--green:#39d17d;--shadow:0 22px 65px rgba(0,0,0,.42)}
*{box-sizing:border-box}html{background:var(--bg);scroll-behavior:smooth}body{margin:0;min-height:100vh;color:var(--text);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:radial-gradient(900px 480px at 50% -160px,rgba(237,27,47,.28),transparent 66%),linear-gradient(180deg,#0b090b 0,#08090b 32%,#07080a 100%);-webkit-font-smoothing:antialiased}.page{width:min(100%,980px);margin:0 auto;padding:18px 16px 72px}.topbar{position:sticky;top:0;z-index:20;display:flex;align-items:center;justify-content:space-between;gap:14px;padding:12px 0;background:linear-gradient(180deg,rgba(7,8,10,.98),rgba(7,8,10,.82),transparent);backdrop-filter:blur(14px)}.brand{display:flex;align-items:center;gap:11px}.brand-mark{width:44px;height:44px;border-radius:15px;display:grid;place-items:center;background:linear-gradient(145deg,#ef2740,#760813);box-shadow:0 10px 28px rgba(237,27,47,.25);border:1px solid rgba(255,255,255,.08);font-size:20px}.brand-copy strong{display:block;font-size:14px;letter-spacing:-.2px}.brand-copy span{display:block;color:var(--muted);font-size:10px;margin-top:2px;text-transform:uppercase;letter-spacing:.12em}.refresh{display:inline-flex;align-items:center;gap:7px;text-decoration:none;color:white;background:#141720;border:1px solid var(--line);border-radius:13px;padding:10px 13px;font-size:12px;font-weight:850;box-shadow:0 8px 24px #0004}
.hero{padding:34px 0 16px}.kicker{display:inline-flex;align-items:center;gap:8px;color:#ffb2ba;font-size:11px;font-weight:900;letter-spacing:.16em;text-transform:uppercase}.hero h1{margin:10px 0 12px;font-size:clamp(38px,7vw,64px);line-height:.98;letter-spacing:-2.6px;max-width:820px}.hero h1 em{font-style:normal;background:linear-gradient(90deg,#fff 0,#fff 45%,#ff9aa5 100%);-webkit-background-clip:text;background-clip:text;color:transparent}.hero p{margin:0;max-width:680px;color:var(--muted);font-size:15px;line-height:1.7}.hero-badges{display:flex;flex-wrap:wrap;gap:8px;margin-top:18px}.badge{display:inline-flex;align-items:center;gap:7px;padding:8px 11px;border-radius:999px;border:1px solid var(--line);background:rgba(17,20,27,.8);font-size:11px;color:#c9ced7}.live-dot{width:7px;height:7px;border-radius:50%;background:var(--green);box-shadow:0 0 0 4px rgba(57,209,125,.1)}
.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:20px 0 30px}.stat{position:relative;overflow:hidden;background:linear-gradient(180deg,rgba(21,24,32,.92),rgba(13,15,20,.92));border:1px solid var(--line);border-radius:18px;padding:16px;box-shadow:0 12px 30px rgba(0,0,0,.18)}.stat:after{content:"";position:absolute;right:-20px;top:-26px;width:76px;height:76px;border-radius:50%;background:rgba(237,27,47,.06)}.stat strong{display:block;font-size:25px;letter-spacing:-.8px}.stat span{display:block;margin-top:5px;color:var(--muted);font-size:10px;letter-spacing:.1em;text-transform:uppercase}.stat.leader strong{font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:5px}
.tabs-shell{display:flex;gap:8px;position:sticky;top:68px;z-index:15;background:rgba(7,8,10,.86);backdrop-filter:blur(16px);padding:8px 0 14px;margin-bottom:12px}.tab-btn{flex:1;appearance:none;border:1px solid var(--line);background:#101319;color:var(--muted);padding:12px 15px;border-radius:14px;font-weight:850;font-size:12px;cursor:pointer;transition:.2s}.tab-btn.active{color:white;background:linear-gradient(180deg,#251116,#170d10);border-color:#5f202a;box-shadow:inset 0 0 0 1px rgba(237,27,47,.08),0 8px 26px rgba(0,0,0,.22)}.tab-panel{display:none}.tab-panel.active{display:block}
.section-head{display:flex;justify-content:space-between;align-items:end;gap:12px;margin:22px 0 14px}.section-head h2{margin:0;font-size:20px;letter-spacing:-.4px}.section-head span{color:var(--muted);font-size:11px}.podium{display:grid;grid-template-columns:1fr 1.08fr 1fr;align-items:end;gap:10px;margin:0 0 28px}.pod{min-width:0;position:relative;text-align:center;padding:20px 10px 16px;border-radius:24px;background:linear-gradient(180deg,#171a22,#0e1015);border:1px solid var(--line);box-shadow:var(--shadow);overflow:hidden}.pod-shine{position:absolute;inset:0;background:radial-gradient(circle at 50% 0,rgba(255,255,255,.05),transparent 42%);pointer-events:none}.pod.first{min-height:250px;border-color:rgba(244,194,78,.45);background:linear-gradient(180deg,rgba(244,194,78,.09),#101217 48%)}.pod.second,.pod.third{min-height:220px}.pod.placeholder{visibility:hidden}.medal{position:absolute;top:8px;right:10px;font-size:27px;filter:drop-shadow(0 5px 10px #0007)}.pod-position{position:relative;font-size:9px;color:var(--muted);font-weight:900;letter-spacing:.16em;text-transform:uppercase;margin-bottom:16px}.avatar-wrap,.avatar-fallback{display:grid;place-items:center;flex:0 0 auto;border-radius:50%;overflow:hidden;background:linear-gradient(145deg,#272c38,#14171e);font-weight:950;letter-spacing:.03em}.avatar-wrap img{width:100%;height:100%;object-fit:cover;display:block}.avatar-wrap .avatar-fallback{width:100%;height:100%}.pod-avatar{position:relative;width:76px;height:76px;margin:0 auto 12px;border:3px solid rgba(255,255,255,.16)}.pod-avatar.avatar-fallback{font-size:23px}.first .pod-avatar{width:94px;height:94px;border-color:var(--gold);box-shadow:0 0 0 5px rgba(244,194,78,.08)}.second .pod-avatar{border-color:var(--silver)}.third .pod-avatar{border-color:var(--bronze)}.pod-name{position:relative;font-weight:900;font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.pod-points{position:relative;margin-top:10px}.pod-points strong{font-size:30px;letter-spacing:-1px}.pod-points span{display:block;color:var(--muted);font-size:10px;text-transform:uppercase;letter-spacing:.12em;margin-top:2px}.pod-wins{position:relative;color:var(--muted);font-size:10px;margin-top:10px}
.rank-shell{background:rgba(13,15,20,.82);border:1px solid var(--line);border-radius:26px;padding:12px;box-shadow:var(--shadow);backdrop-filter:blur(12px)}.rank-toolbar{display:flex;gap:10px;align-items:center;padding:5px 5px 12px}.search{flex:1;display:flex;align-items:center;gap:9px;background:#0b0d11;border:1px solid var(--line);border-radius:13px;padding:0 12px}.search input{width:100%;height:42px;border:0;outline:0;background:transparent;color:white;font:inherit;font-size:12px}.search input::placeholder{color:#676e7c}.rank-row{border:1px solid var(--line);background:#101319;border-radius:17px;margin:8px 0;overflow:hidden;transition:.2s}.rank-row:hover{border-color:#343a48}.rank-main{display:grid;grid-template-columns:40px 48px minmax(0,1fr) auto 34px;gap:10px;align-items:center;padding:12px}.rank-number{width:34px;height:34px;border-radius:11px;display:grid;place-items:center;background:#171a22;color:#9299a8;font-weight:950;font-size:13px}.rank-number.top-1{color:#17130a;background:linear-gradient(145deg,#f7d979,#c99b25)}.rank-number.top-2{color:#17191d;background:linear-gradient(145deg,#ecf0f5,#9da6b4)}.rank-number.top-3{color:#1c120b;background:linear-gradient(145deg,#dfa56f,#9d5e31)}.rank-avatar{width:46px;height:46px;border:2px solid rgba(255,255,255,.11)}.rank-avatar.avatar-fallback{font-size:14px}.rank-user{min-width:0}.rank-user strong{display:block;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.rank-user span{display:block;color:var(--muted);font-size:10px;margin-top:4px}.rank-score{text-align:right}.rank-score strong{font-size:21px}.rank-score span{display:block;color:var(--muted);font-size:9px;text-transform:uppercase;letter-spacing:.1em}.history-toggle{width:32px;height:32px;border-radius:10px;border:1px solid var(--line);background:#171a21;color:#9299a8;font-size:17px;cursor:pointer;transition:.2s}.rank-row.open .history-toggle{transform:rotate(180deg);color:white;border-color:#5c2028;background:#251216}.inline-history{display:grid;grid-template-rows:0fr;transition:grid-template-rows .28s ease}.inline-history-inner{overflow:hidden}.rank-row.open .inline-history{grid-template-rows:1fr}.inline-history-inner{border-top:1px solid var(--line);padding:0 13px}.rank-row.open .inline-history-inner{padding-top:14px;padding-bottom:14px}.inline-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}.inline-head span{font-size:8px;letter-spacing:.14em;color:#ff9ba5;font-weight:900}.inline-head h3{margin:3px 0 0;font-size:13px}.inline-head b{display:grid;place-items:center;width:31px;height:31px;border-radius:10px;background:#241318;border:1px solid #52202a;color:#ffb8bf;font-size:11px}
.history-intro{display:flex;justify-content:space-between;align-items:center;gap:12px;margin:18px 0}.history-intro h2{margin:0;font-size:22px}.history-intro p{margin:5px 0 0;color:var(--muted);font-size:12px}.history-search{max-width:320px;flex:1}.player-history{background:linear-gradient(180deg,#11141a,#0d0f13);border:1px solid var(--line);border-radius:22px;padding:15px;margin:12px 0;box-shadow:0 14px 36px rgba(0,0,0,.18)}.player-history-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px}.player-ident{display:flex;align-items:center;gap:11px;min-width:0}.history-avatar{width:50px;height:50px;border:2px solid rgba(255,255,255,.12)}.history-avatar.avatar-fallback{font-size:15px}.player-ident div{min-width:0}.player-ident span{display:block;color:var(--muted);font-size:9px;text-transform:uppercase;letter-spacing:.1em}.player-ident h3{margin:4px 0 0;font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.player-total{text-align:right}.player-total strong{display:block;font-size:21px}.player-total span{display:block;color:var(--muted);font-size:9px}.match-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}.match-card{display:grid;grid-template-columns:34px minmax(0,1fr);gap:10px;align-items:start;background:#0a0c10;border:1px solid #1d212a;border-radius:15px;padding:12px}.match-status{width:31px;height:31px;border-radius:10px;display:grid;place-items:center;color:#6ce69d;background:rgba(57,209,125,.09);border:1px solid rgba(57,209,125,.18);font-weight:950}.match-content{min-width:0}.match-topline{display:flex;justify-content:space-between;gap:8px;align-items:center}.match-index{color:#ff8d99;font-size:8px;letter-spacing:.1em;font-weight:900}.match-date{color:var(--muted2);font-size:8px;white-space:nowrap}.match-content h4{margin:7px 0 9px;font-size:12px;line-height:1.3}.match-score-row{display:flex;align-items:center;justify-content:space-between;gap:8px;border-top:1px solid #1a1e26;padding-top:8px}.match-score-row span{font-size:9px;color:var(--muted)}.match-score-row strong{font-size:12px;color:#fff}.empty-history,.empty-state{text-align:center;color:var(--muted);padding:26px 12px;font-size:12px}.footer{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-top:28px;padding:18px 4px 4px;color:#656c79;font-size:10px;border-top:1px solid #161920}.footer strong{color:#959baa}
@media(max-width:720px){.stats{grid-template-columns:repeat(2,1fr)}.match-grid{grid-template-columns:1fr}.pod.first{min-height:232px}.pod.second,.pod.third{min-height:205px}}
@media(max-width:520px){.page{padding:12px 10px 54px}.topbar{padding-top:8px}.brand-copy span{display:none}.refresh{padding:9px 10px}.hero{padding-top:25px}.hero h1{font-size:38px;letter-spacing:-1.8px}.hero p{font-size:13px}.tabs-shell{top:61px}.podium{gap:6px}.pod{padding:17px 6px 13px;border-radius:19px}.pod.first{min-height:218px}.pod.second,.pod.third{min-height:193px}.pod-avatar{width:60px;height:60px}.first .pod-avatar{width:73px;height:73px}.pod-name{font-size:12px}.pod-points strong{font-size:24px}.pod-wins{font-size:8px}.medal{font-size:22px}.rank-main{grid-template-columns:34px 43px minmax(0,1fr) auto 30px;gap:7px;padding:10px}.rank-number{width:30px;height:30px}.rank-avatar{width:41px;height:41px}.rank-user span{font-size:9px}.rank-score strong{font-size:18px}.history-intro{display:block}.history-search{max-width:none;margin-top:12px}.player-history{padding:12px}.player-total span{display:none}.footer{display:block;text-align:center}.footer span{display:block;margin-top:4px}}
</style>
</head>
<body>
<main class="page">
  <header class="topbar">
    <div class="brand"><div class="brand-mark">🔴⚫</div><div class="brand-copy"><strong>Gols Flamengo</strong><span>Bolão oficial</span></div></div>
    <a class="refresh" href="/ranking">↻ Atualizar</a>
  </header>

  <section class="hero">
    <div class="kicker">🏆 Ranking oficial</div>
    <h1><em>Quem mais cravou o placar?</em></h1>
    <p>Acompanhe a classificação do bolão, veja quem está no topo e confira exatamente quais partidas cada torcedor acertou.</p>
    <div class="hero-badges"><span class="badge"><span class="live-dot"></span> Dados ao vivo do D1</span><span class="badge">⚡ Cloudflare Worker</span></div>
  </section>

  <section class="stats">
    <div class="stat"><strong>${totalTorcedores}</strong><span>Torcedores pontuando</span></div>
    <div class="stat"><strong>${totalPontos}</strong><span>Pontos no ranking</span></div>
    <div class="stat"><strong>${totalAcertos}</strong><span>Acertos registrados</span></div>
    <div class="stat leader"><strong>${esc(lider)}</strong><span>Líder atual</span></div>
  </section>

  <nav class="tabs-shell" aria-label="Seções do ranking">
    <button class="tab-btn active" data-tab="ranking" type="button">🏆 Ranking</button>
    <button class="tab-btn" data-tab="historico" type="button">⚽ Partidas acertadas</button>
  </nav>

  <section class="tab-panel active" id="tab-ranking">
    <div class="section-head"><h2>Pódio</h2><span>Top 3 geral</span></div>
    <div class="podium">${podium}</div>

    <div class="section-head"><h2>Classificação geral</h2><span>Toque no ▾ para ver os acertos</span></div>
    <div class="rank-shell">
      <div class="rank-toolbar"><label class="search">⌕<input id="rankSearch" type="search" placeholder="Buscar torcedor..." autocomplete="off"></label></div>
      <div id="rankList">${rankingRows}</div>
    </div>
  </section>

  <section class="tab-panel" id="tab-historico">
    <div class="history-intro">
      <div><h2>Partidas acertadas</h2><p>Histórico detalhado por torcedor, direto dos registros de acertos.</p></div>
      <label class="search history-search">⌕<input id="historySearch" type="search" placeholder="Buscar torcedor..." autocomplete="off"></label>
    </div>
    <div id="historyList">${historyGroups || '<div class="empty-state">Nenhum histórico disponível.</div>'}</div>
  </section>

  <footer class="footer"><strong>Gols Flamengo</strong><span>Ranking servido por Cloudflare Worker + D1</span></footer>
</main>
<script>
function toggleHistory(btn){const row=btn.closest('.rank-row');if(row)row.classList.toggle('open')}
document.querySelectorAll('.tab-btn').forEach(btn=>btn.addEventListener('click',()=>{
  document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach(p=>p.classList.remove('active'));
  btn.classList.add('active');
  const panel=document.getElementById('tab-'+btn.dataset.tab);if(panel)panel.classList.add('active');
  window.scrollTo({top:document.querySelector('.tabs-shell').offsetTop-8,behavior:'smooth'});
}));
function bindSearch(inputId, selector){const input=document.getElementById(inputId);if(!input)return;input.addEventListener('input',()=>{const q=input.value.trim().toLowerCase();document.querySelectorAll(selector).forEach(el=>{el.style.display=!q||String(el.dataset.name||'').includes(q)?'':'none'})})}
bindSearch('rankSearch','.rank-row');bindSearch('historySearch','.player-history');
</script>
</body>
</html>`;

    return new Response(html, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer"
      }
    });
  } catch (error) {
    console.error("Erro ao renderizar ranking", error);
    return new Response("Não foi possível carregar o ranking agora.", {
      status: 500,
      headers: { "Content-Type": "text/plain; charset=utf-8" }
    });
  }
}
