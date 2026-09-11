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
    return new Intl.DateTimeFormat("pt-BR", {
      day: "2-digit",
      month: "2-digit",
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
    <div class="name">${esc(usuario.nome || "Torcedor")}</div>
    <div class="pts"><b>${Number(usuario.pontos || 0)}</b><span> ponto(s)</span></div>
    <div class="wins">${Number(usuario.acertos_salvos || 0)} acerto(s) no histórico</div>
  </article>`;
}

function historicoMarkup(acertos = []) {
  if (!acertos.length) {
    return '<div class="history-empty">Nenhuma partida detalhada foi salva para este torcedor ainda.</div>';
  }

  return `<div class="history-list">${acertos.map((a, i) => `
    <div class="history-item">
      <div class="history-icon">✓</div>
      <div class="history-main">
        <strong>${esc(a.confronto || "Partida")}</strong>
        <div class="history-meta">
          <span>🎯 Palpite/acerto: <b>${esc(a.placar || "Placar correto")}</b></span>
          <span>📅 ${esc(formatarData(a.resgatado_em))}</span>
        </div>
      </div>
      <div class="history-number">#${i + 1}</div>
    </div>`).join("")}</div>`;
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

    const linhas = ranking.length
      ? ranking.map((u, i) => {
          const historico = acertosPorUsuario.get(String(u.id)) || [];
          return `
          <details class="rank-card" ${i === 0 ? "open" : ""}>
            <summary class="rank-summary">
              <div class="position-badge">${i + 1}<small>º</small></div>
              ${avatarMarkup(u, "list-avatar")}
              <div class="who">
                <strong>${esc(u.nome || "Torcedor")}</strong>
                <span>${Number(u.acertos_salvos || 0)} partida(s) acertada(s)</span>
              </div>
              <div class="score"><b>${Number(u.pontos || 0)}</b><span>pontos</span></div>
              <div class="chevron">⌄</div>
            </summary>
            <div class="rank-details">
              <div class="details-head">
                <div>
                  <span class="eyebrow">HISTÓRICO</span>
                  <h3>Partidas acertadas</h3>
                </div>
                <div class="details-count">${historico.length}</div>
              </div>
              ${historicoMarkup(historico)}
            </div>
          </details>`;
        }).join("")
      : '<div class="empty">Ainda não há pontuações no ranking.</div>';

    const totalTorcedores = ranking.length;
    const totalPontos = ranking.reduce((s, u) => s + Number(u.pontos || 0), 0);
    const totalAcertos = ranking.reduce((s, u) => s + Number(u.acertos_salvos || 0), 0);

    const html = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#090a0d">
<title>Ranking Gols Flamengo</title>
<style>
:root{
  --bg:#08090b;--surface:#101217;--surface-2:#151820;--surface-3:#1b1f29;
  --line:#252a35;--line-soft:#1c2029;--text:#f7f8fa;--muted:#959baa;
  --red:#e01e2f;--red-dark:#8d0e18;--gold:#f5c451;--silver:#c9cfd8;--bronze:#c9854e;
  --green:#31c76a;--shadow:0 20px 60px rgba(0,0,0,.36)
}
*{box-sizing:border-box}
html{background:var(--bg)}
body{margin:0;min-height:100vh;color:var(--text);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:
  radial-gradient(900px 460px at 50% -180px,rgba(224,30,47,.34),transparent 68%),
  linear-gradient(180deg,#0d090b 0,#090a0d 26%,#08090b 100%);-webkit-font-smoothing:antialiased}
a{color:inherit}.wrap{width:min(100%,900px);margin:0 auto;padding:28px 16px 52px}
.topbar{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:26px}.brand{display:flex;align-items:center;gap:12px}.brand-mark{width:48px;height:48px;border-radius:16px;background:linear-gradient(145deg,#ef2438,#890b15);display:grid;place-items:center;box-shadow:0 12px 34px rgba(224,30,47,.26);font-size:22px;border:1px solid rgba(255,255,255,.08)}.brand strong{display:block;font-size:15px}.brand span{display:block;color:var(--muted);font-size:12px;margin-top:2px}.refresh{display:inline-flex;align-items:center;gap:7px;text-decoration:none;background:var(--surface-2);border:1px solid var(--line);border-radius:12px;padding:10px 13px;font-size:13px;font-weight:800;box-shadow:0 8px 24px rgba(0,0,0,.18)}
.hero{padding:8px 0 8px}.hero-kicker{display:inline-flex;align-items:center;gap:7px;color:#ffb2ba;font-size:12px;font-weight:900;letter-spacing:.12em}.hero h1{margin:9px 0 8px;font-size:clamp(30px,6vw,48px);line-height:1.02;letter-spacing:-1.6px}.hero p{margin:0;color:var(--muted);font-size:14px;line-height:1.6;max-width:620px}
.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:22px 0 28px}.stat{background:rgba(16,18,23,.88);border:1px solid var(--line);border-radius:16px;padding:14px 15px;box-shadow:0 10px 30px rgba(0,0,0,.14)}.stat b{display:block;font-size:22px;letter-spacing:-.5px}.stat span{display:block;color:var(--muted);font-size:11px;margin-top:3px;text-transform:uppercase;letter-spacing:.08em}
.section-title{display:flex;align-items:end;justify-content:space-between;margin:0 0 13px}.section-title h2{margin:0;font-size:17px}.section-title span{color:var(--muted);font-size:12px}.podium{display:grid;grid-template-columns:1fr 1.08fr 1fr;align-items:end;gap:10px;margin:0 0 30px}.pod{min-width:0;position:relative;text-align:center;padding:18px 10px 15px;border-radius:22px;background:linear-gradient(180deg,var(--surface-2),var(--surface));border:1px solid var(--line);box-shadow:var(--shadow);overflow:visible}.pod.first{min-height:224px;border-color:rgba(245,196,81,.42);background:linear-gradient(180deg,rgba(245,196,81,.08),var(--surface) 45%)}.pod.second,.pod.third{min-height:196px}.pod.placeholder{visibility:hidden}.medal{position:absolute;top:-17px;left:50%;transform:translateX(-50%);font-size:27px;filter:drop-shadow(0 5px 10px #0007)}.pod-position{font-size:10px;color:var(--muted);font-weight:800;text-transform:uppercase;letter-spacing:.1em;margin:0 0 10px}.avatar-wrap,.avatar-fallback{display:grid;place-items:center;flex:0 0 auto;border-radius:50%;overflow:hidden;background:linear-gradient(145deg,#252936,#161922);font-weight:900;letter-spacing:.04em}.avatar-wrap img{width:100%;height:100%;object-fit:cover;display:block}.avatar-wrap .avatar-fallback{width:100%;height:100%;border:0}.pod-avatar{width:72px;height:72px;margin:0 auto 11px;border:3px solid rgba(255,255,255,.16)}.pod-avatar.avatar-fallback{font-size:24px}.first .pod-avatar{width:88px;height:88px;border-color:var(--gold);box-shadow:0 0 0 5px rgba(245,196,81,.08)}.second .pod-avatar{border-color:var(--silver)}.third .pod-avatar{border-color:var(--bronze)}.pod .name{font-size:15px;font-weight:900;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:4px}.pod .pts{margin-top:8px}.pod .pts b{font-size:25px}.pod .pts span{font-size:12px;color:var(--muted)}.pod .wins{font-size:10px;color:var(--muted);margin-top:7px}
.ranking-shell{background:rgba(14,16,21,.84);border:1px solid var(--line);border-radius:24px;padding:12px;box-shadow:var(--shadow);backdrop-filter:blur(14px)}.ranking-head{display:flex;justify-content:space-between;align-items:center;padding:8px 7px 15px}.ranking-head h2{margin:0;font-size:17px}.ranking-head span{color:var(--muted);font-size:11px}.rank-card{background:var(--surface);border:1px solid var(--line-soft);border-radius:17px;margin:8px 0;overflow:hidden;transition:border-color .2s,background .2s}.rank-card[open]{border-color:#303746;background:#11141a}.rank-summary{list-style:none;display:grid;grid-template-columns:42px 52px minmax(0,1fr) auto 22px;gap:10px;align-items:center;padding:13px;cursor:pointer;user-select:none}.rank-summary::-webkit-details-marker{display:none}.position-badge{font-size:17px;font-weight:950;color:#b4bac7;text-align:center}.position-badge small{font-size:10px}.list-avatar{width:48px;height:48px;border:2px solid rgba(255,255,255,.12)}.list-avatar.avatar-fallback{font-size:15px}.who{min-width:0}.who strong{display:block;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.who span{display:block;color:var(--muted);font-size:11px;margin-top:4px}.score{text-align:right;min-width:46px}.score b{display:block;font-size:20px;line-height:1}.score span{display:block;color:var(--muted);font-size:10px;margin-top:4px}.chevron{font-size:18px;color:#747b89;text-align:center;transition:transform .2s}.rank-card[open] .chevron{transform:rotate(180deg)}.rank-details{border-top:1px solid var(--line-soft);padding:15px 14px 14px;background:linear-gradient(180deg,rgba(255,255,255,.018),transparent)}.details-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:11px}.details-head h3{margin:3px 0 0;font-size:14px}.eyebrow{font-size:9px;font-weight:900;letter-spacing:.14em;color:#ff8792}.details-count{min-width:31px;height:31px;border-radius:10px;display:grid;place-items:center;background:#241419;border:1px solid #4f2028;color:#ffb6bd;font-weight:900;font-size:12px}.history-list{display:grid;gap:8px}.history-item{display:grid;grid-template-columns:34px minmax(0,1fr) auto;align-items:center;gap:10px;padding:11px;background:#0d0f13;border:1px solid #1c2028;border-radius:13px}.history-icon{width:30px;height:30px;border-radius:10px;display:grid;place-items:center;background:rgba(49,199,106,.1);color:#64e491;border:1px solid rgba(49,199,106,.18);font-weight:950}.history-main{min-width:0}.history-main strong{display:block;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.history-meta{display:flex;flex-wrap:wrap;gap:5px 12px;margin-top:5px;color:var(--muted);font-size:10px}.history-meta b{color:#fff}.history-number{font-size:10px;color:#666d7a}.history-empty{padding:18px;text-align:center;color:var(--muted);font-size:12px;border:1px dashed #2a2f39;border-radius:13px}.empty{text-align:center;padding:35px 18px;color:var(--muted)}.footer{text-align:center;color:#626977;font-size:11px;margin-top:22px}
@media(max-width:620px){.wrap{padding:20px 10px 34px}.topbar{margin-bottom:20px}.brand-mark{width:42px;height:42px;border-radius:14px}.refresh{padding:9px 11px}.hero h1{font-size:34px}.stats{gap:7px;margin:18px 0 25px}.stat{padding:12px 10px}.stat b{font-size:20px}.stat span{font-size:9px}.podium{gap:6px}.pod{padding:15px 6px 12px;border-radius:18px}.pod.first{min-height:204px}.pod.second,.pod.third{min-height:181px}.pod-avatar{width:60px;height:60px}.first .pod-avatar{width:76px;height:76px}.pod .name{font-size:13px}.pod .wins{font-size:9px}.ranking-shell{padding:7px;border-radius:19px}.rank-summary{grid-template-columns:34px 46px minmax(0,1fr) auto 18px;gap:8px;padding:11px 8px}.list-avatar{width:42px;height:42px}.who strong{font-size:13px}.who span{font-size:10px}.score b{font-size:18px}.rank-details{padding:13px 9px}.history-item{padding:10px 8px;grid-template-columns:31px minmax(0,1fr) auto}.history-main strong{font-size:11px}.history-meta{font-size:9px}}
@media(max-width:390px){.brand span{display:none}.hero h1{font-size:30px}.stats{grid-template-columns:1fr 1fr}.stat:last-child{grid-column:1/-1}.podium{gap:4px}.pod-avatar{width:54px;height:54px}.first .pod-avatar{width:67px;height:67px}.pod.first{min-height:193px}.pod.second,.pod.third{min-height:173px}.pod .pts b{font-size:21px}.rank-summary{grid-template-columns:29px 40px minmax(0,1fr) auto 15px}.list-avatar{width:38px;height:38px}.score{min-width:38px}.chevron{font-size:15px}}
</style>
</head>
<body>
<main class="wrap">
  <header class="topbar">
    <div class="brand">
      <div class="brand-mark">🔴⚫</div>
      <div><strong>Gols Flamengo</strong><span>Bolão oficial da comunidade</span></div>
    </div>
    <a class="refresh" href="/ranking" aria-label="Atualizar ranking">↻ Atualizar</a>
  </header>

  <section class="hero">
    <div class="hero-kicker">🏆 RANKING OFICIAL</div>
    <h1>Quem mais cravou o placar?</h1>
    <p>Classificação atualizada direto do D1. Toque em qualquer torcedor para abrir o histórico e conferir as partidas que ele acertou.</p>
  </section>

  <section class="stats" aria-label="Resumo do ranking">
    <div class="stat"><b>${totalTorcedores}</b><span>Torcedores pontuando</span></div>
    <div class="stat"><b>${totalPontos}</b><span>Pontos no ranking</span></div>
    <div class="stat"><b>${totalAcertos}</b><span>Acertos salvos</span></div>
  </section>

  <div class="section-title"><h2>Pódio</h2><span>Top 3</span></div>
  <section class="podium" aria-label="Pódio">${podium}</section>

  <section class="ranking-shell">
    <div class="ranking-head"><h2>Classificação geral</h2><span>Toque para ver os acertos</span></div>
    ${linhas}
  </section>

  <div class="footer">Gols Flamengo • Ranking servido pelo Cloudflare Worker • Dados do D1</div>
</main>
</body>
</html>`;

    return new Response(html, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
        "Content-Security-Policy": "default-src 'self'; img-src 'self' https: data:; style-src 'unsafe-inline'; script-src 'none'; base-uri 'none'; frame-ancestors 'none'"
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
