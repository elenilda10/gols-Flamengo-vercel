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
  return (partes.slice(0, 2).map((p) => p[0]).join("") || "T").toUpperCase();
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
    return new Intl.DateTimeFormat("pt-BR", {
      day: "2-digit",
      month: "short",
      year: "numeric"
    }).format(new Date(n));
  } catch {
    return "Data não registrada";
  }
}

function cardPodio(usuario, classe, medalha, posicao) {
  if (!usuario) return '<div class="pod placeholder"></div>';
  return `<article class="pod ${classe}">
    <div class="medal">${medalha}</div>
    <div class="pod-position">${posicao}º lugar</div>
    ${avatarMarkup(usuario, "pod-avatar")}
    <div class="pod-name">${esc(usuario.nome || "Torcedor")}</div>
    <div class="pod-score"><b>${Number(usuario.pontos || 0)}</b><span> pts</span></div>
    <div class="pod-wins">${Number(usuario.acertos_salvos || 0)} acerto(s)</div>
  </article>`;
}

function historicoMarkup(acertos = []) {
  if (!acertos.length) {
    return '<div class="history-empty">Nenhuma partida detalhada foi salva para este torcedor ainda.</div>';
  }

  return `<div class="history-list">${acertos.map((a, i) => `
    <article class="history-item">
      <div class="history-check">✓</div>
      <div class="history-main">
        <strong>${esc(a.confronto || "Partida")}</strong>
        <div class="history-meta">
          <span class="result-pill">🎯 ${esc(a.placar || "Placar correto")}</span>
          <span>${esc(formatarData(a.resgatado_em))}</span>
        </div>
      </div>
      <div class="history-index">${String(i + 1).padStart(2, "0")}</div>
    </article>`).join("")}</div>`;
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
      ORDER BY a.user_id ASC, CAST(a.resgatado_em AS INTEGER) DESC, a.id DESC
    `).all();

    const acertosPorUsuario = new Map();
    for (const a of acertos) {
      const chave = String(a.user_id);
      if (!acertosPorUsuario.has(chave)) acertosPorUsuario.set(chave, []);
      acertosPorUsuario.get(chave).push(a);
    }

    const podium =
      cardPodio(ranking[1], "second", "🥈", 2) +
      cardPodio(ranking[0], "first", "🥇", 1) +
      cardPodio(ranking[2], "third", "🥉", 3);

    const linhasRanking = ranking.length
      ? ranking.map((u, i) => `
        <article class="rank-row" data-name="${esc(String(u.nome || "Torcedor").toLowerCase())}">
          <div class="position ${i < 3 ? `top-${i + 1}` : ""}">${i + 1}</div>
          ${avatarMarkup(u, "rank-avatar")}
          <div class="rank-person">
            <strong>${esc(u.nome || "Torcedor")}</strong>
            <span>${Number(u.acertos_salvos || 0)} partida(s) registrada(s)</span>
          </div>
          <div class="rank-points"><b>${Number(u.pontos || 0)}</b><small>pontos</small></div>
          <button class="history-link" type="button" data-open-history="${esc(u.id)}" aria-label="Ver partidas de ${esc(u.nome || "Torcedor")}">Ver acertos</button>
        </article>`).join("")
      : '<div class="empty-state">Ainda não há pontuações no ranking.</div>';

    const historicos = ranking.length
      ? ranking.map((u, i) => {
          const historico = acertosPorUsuario.get(String(u.id)) || [];
          return `
          <details class="history-user" data-user-id="${esc(u.id)}" data-name="${esc(String(u.nome || "Torcedor").toLowerCase())}">
            <summary>
              <div class="history-rank">${i + 1}º</div>
              ${avatarMarkup(u, "history-avatar")}
              <div class="history-user-name">
                <strong>${esc(u.nome || "Torcedor")}</strong>
                <span>${historico.length} partida(s) no histórico</span>
              </div>
              <div class="history-user-score"><b>${Number(u.pontos || 0)}</b><span>pts</span></div>
              <div class="expand-icon">+</div>
            </summary>
            <div class="history-body">
              <div class="history-title-row">
                <div>
                  <span class="eyebrow">HISTÓRICO OFICIAL</span>
                  <h3>Partidas acertadas</h3>
                </div>
                <span class="history-count">${historico.length}</span>
              </div>
              ${historicoMarkup(historico)}
            </div>
          </details>`;
        }).join("")
      : '<div class="empty-state">Ainda não há histórico de acertos.</div>';

    const totalTorcedores = ranking.length;
    const totalPontos = ranking.reduce((s, u) => s + Number(u.pontos || 0), 0);
    const totalAcertos = ranking.reduce((s, u) => s + Number(u.acertos_salvos || 0), 0);
    const lider = ranking[0]?.nome || "—";

    const html = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#07080b">
<title>Ranking Gols Flamengo</title>
<style>
:root{
  --bg:#07080b;--surface:#0d1016;--surface-2:#121722;--surface-3:#181e2a;
  --line:#242a37;--line-soft:#1a202b;--text:#f7f8fb;--muted:#9299a8;--muted-2:#6f7685;
  --red:#ef233c;--red-2:#b80f24;--red-soft:rgba(239,35,60,.12);
  --gold:#f6c95f;--silver:#d3d8e1;--bronze:#d18c53;--green:#46d17b;
  --shadow:0 24px 70px rgba(0,0,0,.36);--radius:24px
}
*{box-sizing:border-box}
html{background:var(--bg);scroll-behavior:smooth}
body{margin:0;min-height:100vh;color:var(--text);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:
  radial-gradient(900px 560px at 50% -220px,rgba(239,35,60,.28),transparent 68%),
  radial-gradient(700px 420px at 100% 8%,rgba(103,72,255,.08),transparent 65%),
  linear-gradient(180deg,#0b080b 0,#08090d 36%,#07080b 100%);-webkit-font-smoothing:antialiased}
button,input{font:inherit}.page{width:min(100%,980px);margin:0 auto;padding:20px 16px 64px}
.topbar{position:sticky;top:0;z-index:20;margin:0 -6px 28px;padding:10px 6px;display:flex;align-items:center;justify-content:space-between;gap:14px;background:linear-gradient(180deg,rgba(7,8,11,.96),rgba(7,8,11,.78),transparent);backdrop-filter:blur(16px)}
.brand{display:flex;align-items:center;gap:11px}.brand-mark{width:44px;height:44px;border-radius:15px;display:grid;place-items:center;background:linear-gradient(145deg,#ff304a,#8e0a19);border:1px solid rgba(255,255,255,.08);box-shadow:0 10px 28px rgba(239,35,60,.22);font-size:20px}.brand strong{display:block;font-size:14px;letter-spacing:-.2px}.brand span{display:block;font-size:10px;color:var(--muted);margin-top:2px}.refresh{display:inline-flex;align-items:center;gap:7px;text-decoration:none;color:#fff;background:#11151d;border:1px solid var(--line);border-radius:13px;padding:10px 13px;font-size:12px;font-weight:800}
.hero{display:grid;grid-template-columns:1.45fr .8fr;gap:22px;align-items:end;margin-bottom:24px}.hero-copy{padding:18px 0}.kicker{display:inline-flex;align-items:center;gap:7px;color:#ff9eaa;font-size:11px;font-weight:950;letter-spacing:.13em;text-transform:uppercase}.hero h1{margin:10px 0 12px;font-size:clamp(36px,7vw,64px);line-height:.98;letter-spacing:-2.5px;max-width:690px}.hero p{margin:0;max-width:610px;color:var(--muted);font-size:14px;line-height:1.7}.leader-card{position:relative;overflow:hidden;padding:18px;border-radius:22px;background:linear-gradient(145deg,rgba(239,35,60,.15),rgba(18,23,34,.92));border:1px solid rgba(239,35,60,.22);box-shadow:var(--shadow)}.leader-card:after{content:"";position:absolute;width:140px;height:140px;border-radius:50%;right:-50px;top:-70px;background:rgba(239,35,60,.16);filter:blur(4px)}.leader-card span{display:block;color:#ff9eaa;font-size:10px;font-weight:900;letter-spacing:.12em}.leader-card strong{display:block;font-size:20px;margin-top:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.leader-card small{display:block;color:var(--muted);margin-top:4px}
.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:0 0 30px}.stat{position:relative;overflow:hidden;background:linear-gradient(180deg,rgba(18,23,34,.95),rgba(12,15,21,.95));border:1px solid var(--line);border-radius:18px;padding:16px 17px}.stat b{display:block;font-size:24px;letter-spacing:-.6px}.stat span{display:block;color:var(--muted);font-size:10px;letter-spacing:.08em;text-transform:uppercase;margin-top:4px}.stat:before{content:"";position:absolute;inset:auto 0 0;height:2px;background:linear-gradient(90deg,var(--red),transparent 72%);opacity:.7}
.tabs-wrap{position:sticky;top:64px;z-index:15;margin:0 0 24px}.tabs{display:grid;grid-template-columns:1fr 1fr;gap:7px;padding:6px;background:rgba(14,17,23,.92);border:1px solid var(--line);border-radius:16px;backdrop-filter:blur(16px);box-shadow:0 12px 35px rgba(0,0,0,.22)}.tab-btn{border:0;border-radius:11px;padding:11px 13px;background:transparent;color:var(--muted);font-size:12px;font-weight:850;cursor:pointer}.tab-btn.active{color:#fff;background:linear-gradient(180deg,#242a36,#1a1f29);box-shadow:inset 0 1px 0 rgba(255,255,255,.06)}.tab-panel{display:none}.tab-panel.active{display:block}
.section-head{display:flex;align-items:end;justify-content:space-between;gap:14px;margin:0 0 14px}.section-head h2{margin:0;font-size:18px;letter-spacing:-.3px}.section-head p{margin:4px 0 0;color:var(--muted);font-size:11px}.section-tag{font-size:10px;color:var(--muted);border:1px solid var(--line);border-radius:999px;padding:6px 9px;background:#0e1118}
.podium{display:grid;grid-template-columns:1fr 1.1fr 1fr;align-items:end;gap:10px;margin:22px 0 34px}.pod{min-width:0;text-align:center;position:relative;padding:17px 10px 16px;border-radius:23px;background:linear-gradient(180deg,#151a24,#0d1016);border:1px solid var(--line);box-shadow:var(--shadow)}.pod.first{min-height:230px;border-color:rgba(246,201,95,.42);background:linear-gradient(180deg,rgba(246,201,95,.09),#11141b 48%,#0d1016)}.pod.second,.pod.third{min-height:202px}.pod.placeholder{visibility:hidden}.medal{position:absolute;top:-20px;left:50%;transform:translateX(-50%);font-size:30px;filter:drop-shadow(0 5px 11px #0008)}.pod-position{font-size:9px;font-weight:950;letter-spacing:.13em;text-transform:uppercase;color:var(--muted);margin-bottom:10px}.avatar-wrap,.avatar-fallback{display:grid;place-items:center;flex:0 0 auto;border-radius:50%;overflow:hidden;background:linear-gradient(145deg,#252b38,#151922);font-weight:950;letter-spacing:.04em}.avatar-wrap img{width:100%;height:100%;object-fit:cover}.avatar-wrap .avatar-fallback{width:100%;height:100%;border:0}.pod-avatar{width:74px;height:74px;margin:0 auto 12px;border:3px solid rgba(255,255,255,.15)}.first .pod-avatar{width:92px;height:92px;border-color:var(--gold);box-shadow:0 0 0 5px rgba(246,201,95,.08),0 12px 30px rgba(0,0,0,.3)}.second .pod-avatar{border-color:var(--silver)}.third .pod-avatar{border-color:var(--bronze)}.pod-avatar.avatar-fallback{font-size:24px}.pod-name{font-size:14px;font-weight:900;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.pod-score{margin-top:9px}.pod-score b{font-size:28px}.pod-score span{font-size:11px;color:var(--muted)}.pod-wins{font-size:10px;color:var(--muted);margin-top:7px}
.list-shell{background:rgba(12,15,21,.86);border:1px solid var(--line);border-radius:var(--radius);padding:10px;box-shadow:var(--shadow)}.rank-row{display:grid;grid-template-columns:38px 52px minmax(0,1fr) 56px auto;gap:11px;align-items:center;padding:12px;border-radius:16px;border:1px solid transparent;transition:.2s}.rank-row+.rank-row{border-top-color:var(--line-soft);border-top-left-radius:0;border-top-right-radius:0}.rank-row:hover{background:#11151d;border-color:#232a36}.position{width:32px;height:32px;border-radius:10px;display:grid;place-items:center;color:#a1a8b5;background:#141821;font-size:12px;font-weight:950}.position.top-1{color:#1d1707;background:linear-gradient(145deg,#ffe28b,#d5a93a)}.position.top-2{color:#222831;background:linear-gradient(145deg,#f0f3f7,#aeb7c4)}.position.top-3{color:#2f1909;background:linear-gradient(145deg,#e8a56e,#ad6634)}.rank-avatar{width:48px;height:48px;border:2px solid rgba(255,255,255,.1)}.rank-avatar.avatar-fallback{font-size:15px}.rank-person{min-width:0}.rank-person strong{display:block;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.rank-person span{display:block;color:var(--muted);font-size:10px;margin-top:4px}.rank-points{text-align:right}.rank-points b{display:block;font-size:19px;line-height:1}.rank-points small{display:block;font-size:9px;color:var(--muted);margin-top:4px}.history-link{border:1px solid #303744;background:#171c25;color:#d9dde4;border-radius:10px;padding:8px 9px;font-size:10px;font-weight:850;cursor:pointer}.history-link:hover{border-color:#4b5565;color:#fff}
.searchbar{display:flex;align-items:center;gap:10px;background:#0e1218;border:1px solid var(--line);border-radius:14px;padding:0 13px;margin-bottom:14px}.searchbar span{color:var(--muted)}.searchbar input{width:100%;border:0;outline:0;background:transparent;color:#fff;padding:12px 0;font-size:12px}.searchbar input::placeholder{color:#687080}.history-user{background:#0e1117;border:1px solid var(--line-soft);border-radius:18px;margin:9px 0;overflow:hidden}.history-user[open]{border-color:#323a49;background:#10141b}.history-user summary{list-style:none;display:grid;grid-template-columns:38px 48px minmax(0,1fr) 50px 26px;gap:10px;align-items:center;padding:13px;cursor:pointer}.history-user summary::-webkit-details-marker{display:none}.history-rank{font-size:11px;font-weight:900;color:var(--muted);text-align:center}.history-avatar{width:44px;height:44px;border:2px solid rgba(255,255,255,.1)}.history-avatar.avatar-fallback{font-size:14px}.history-user-name{min-width:0}.history-user-name strong{display:block;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.history-user-name span{display:block;color:var(--muted);font-size:10px;margin-top:4px}.history-user-score{text-align:right}.history-user-score b{display:block;font-size:17px}.history-user-score span{display:block;font-size:9px;color:var(--muted)}.expand-icon{width:24px;height:24px;border-radius:8px;display:grid;place-items:center;background:#171c25;color:#9098a8;font-weight:900;transition:transform .2s}.history-user[open] .expand-icon{transform:rotate(45deg);color:#fff}.history-body{border-top:1px solid var(--line-soft);padding:15px;background:linear-gradient(180deg,rgba(255,255,255,.014),transparent)}.history-title-row{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}.eyebrow{display:block;font-size:8px;font-weight:950;letter-spacing:.14em;color:#ff8e9c}.history-title-row h3{margin:4px 0 0;font-size:14px}.history-count{min-width:32px;height:32px;border-radius:10px;display:grid;place-items:center;background:var(--red-soft);border:1px solid rgba(239,35,60,.23);color:#ffabb5;font-size:11px;font-weight:900}.history-list{display:grid;gap:8px}.history-item{display:grid;grid-template-columns:34px minmax(0,1fr) auto;gap:10px;align-items:center;background:#0a0d12;border:1px solid #191e28;border-radius:13px;padding:11px}.history-check{width:29px;height:29px;border-radius:9px;display:grid;place-items:center;background:rgba(70,209,123,.1);border:1px solid rgba(70,209,123,.19);color:#69e79a;font-weight:950}.history-main{min-width:0}.history-main strong{display:block;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.history-meta{display:flex;align-items:center;flex-wrap:wrap;gap:6px 10px;margin-top:6px;font-size:9px;color:var(--muted)}.result-pill{color:#fff;background:#151a22;border:1px solid #242b36;border-radius:999px;padding:3px 7px}.history-index{font-size:9px;color:#555d6b}.history-empty,.empty-state{text-align:center;color:var(--muted);padding:28px 14px;font-size:12px}.footer{margin-top:34px;text-align:center;color:#555c69;font-size:10px}.footer b{color:#7d8594}
@media(max-width:700px){.page{padding:14px 11px 44px}.topbar{margin-bottom:18px}.hero{grid-template-columns:1fr;gap:12px}.hero-copy{padding-bottom:0}.hero h1{font-size:40px;letter-spacing:-1.8px}.leader-card{display:none}.stats{grid-template-columns:1fr 1fr}.stat:last-child{grid-column:1/-1}.podium{gap:6px}.pod{padding-left:6px;padding-right:6px}.pod.first{min-height:214px}.pod.second,.pod.third{min-height:190px}.pod-avatar{width:62px;height:62px}.first .pod-avatar{width:78px;height:78px}.pod-name{font-size:12px}.pod-score b{font-size:23px}.rank-row{grid-template-columns:34px 46px minmax(0,1fr) 44px;padding:10px 8px;gap:8px}.rank-avatar{width:42px;height:42px}.history-link{display:none}.rank-person strong{font-size:12px}.rank-person span{font-size:9px}.history-user summary{grid-template-columns:32px 43px minmax(0,1fr) 40px 24px;padding:11px 9px;gap:8px}.history-avatar{width:40px;height:40px}.tabs-wrap{top:58px}}
@media(max-width:430px){.brand span{display:none}.refresh{padding:9px 11px}.hero h1{font-size:36px}.stats{gap:7px}.stat{padding:13px}.pod-wins{font-size:9px}.pod-position{font-size:8px}.pod .medal{font-size:26px}.list-shell{padding:7px}.history-body{padding:12px}.history-item{grid-template-columns:30px minmax(0,1fr);padding:10px}.history-index{display:none}}
</style>
</head>
<body>
<main class="page">
  <header class="topbar">
    <div class="brand">
      <div class="brand-mark">🔴⚫</div>
      <div><strong>Gols Flamengo</strong><span>Ranking oficial do bolão</span></div>
    </div>
    <a class="refresh" href="/ranking">↻ Atualizar</a>
  </header>

  <section class="hero">
    <div class="hero-copy">
      <div class="kicker">🏆 Ranking oficial</div>
      <h1>Quem mais cravou o placar?</h1>
      <p>Acompanhe a classificação e consulte, em uma aba separada, todas as partidas registradas no histórico de cada torcedor.</p>
    </div>
    <aside class="leader-card">
      <span>LÍDER ATUAL</span>
      <strong>${esc(lider)}</strong>
      <small>${ranking[0] ? `${Number(ranking[0].pontos || 0)} pontos no ranking` : "Ranking ainda vazio"}</small>
    </aside>
  </section>

  <section class="stats" aria-label="Resumo do ranking">
    <div class="stat"><b>${totalTorcedores}</b><span>Torcedores pontuando</span></div>
    <div class="stat"><b>${totalPontos}</b><span>Pontos no ranking</span></div>
    <div class="stat"><b>${totalAcertos}</b><span>Acertos salvos</span></div>
  </section>

  <div class="tabs-wrap">
    <nav class="tabs" aria-label="Navegação do ranking">
      <button class="tab-btn active" type="button" data-tab="ranking">🏆 Classificação</button>
      <button class="tab-btn" type="button" data-tab="historico">🎯 Partidas acertadas</button>
    </nav>
  </div>

  <section class="tab-panel active" id="panel-ranking">
    <div class="section-head"><div><h2>Pódio</h2><p>Os três maiores pontuadores</p></div><span class="section-tag">Top 3</span></div>
    <div class="podium">${podium}</div>

    <div class="section-head"><div><h2>Classificação geral</h2><p>Ordenada por pontuação</p></div><span class="section-tag">${totalTorcedores} jogadores</span></div>
    <div class="list-shell">${linhasRanking}</div>
  </section>

  <section class="tab-panel" id="panel-historico">
    <div class="section-head"><div><h2>Partidas acertadas</h2><p>Abra um torcedor para conferir o histórico completo</p></div><span class="section-tag">${totalAcertos} registros</span></div>
    <label class="searchbar"><span>⌕</span><input id="history-search" type="search" placeholder="Buscar torcedor..." autocomplete="off"></label>
    <div id="history-users">${historicos}</div>
    <div id="history-no-results" class="empty-state" style="display:none">Nenhum torcedor encontrado.</div>
  </section>

  <footer class="footer"><b>Gols Flamengo</b> • Dados atualizados diretamente do Cloudflare D1</footer>
</main>
<script>
(() => {
  const buttons = [...document.querySelectorAll('.tab-btn')];
  const panels = {
    ranking: document.getElementById('panel-ranking'),
    historico: document.getElementById('panel-historico')
  };

  function abrirAba(nome) {
    buttons.forEach((b) => b.classList.toggle('active', b.dataset.tab === nome));
    Object.entries(panels).forEach(([key, panel]) => panel.classList.toggle('active', key === nome));
    history.replaceState(null, '', nome === 'historico' ? '#historico' : location.pathname);
  }

  buttons.forEach((button) => button.addEventListener('click', () => abrirAba(button.dataset.tab)));

  document.querySelectorAll('[data-open-history]').forEach((button) => {
    button.addEventListener('click', () => {
      const id = button.dataset.openHistory;
      abrirAba('historico');
      requestAnimationFrame(() => {
        const alvo = document.querySelector('.history-user[data-user-id="' + CSS.escape(id) + '"]');
        if (alvo) {
          alvo.open = true;
          alvo.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      });
    });
  });

  const search = document.getElementById('history-search');
  const users = [...document.querySelectorAll('.history-user')];
  const noResults = document.getElementById('history-no-results');
  search?.addEventListener('input', () => {
    const q = search.value.trim().toLowerCase();
    let visible = 0;
    users.forEach((el) => {
      const show = !q || (el.dataset.name || '').includes(q);
      el.style.display = show ? '' : 'none';
      if (show) visible++;
    });
    noResults.style.display = visible ? 'none' : 'block';
  });

  if (location.hash === '#historico') abrirAba('historico');
})();
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
