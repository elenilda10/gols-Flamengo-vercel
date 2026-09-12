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
  const fallback = esc(iniciais(nome));
  return `<span class="avatar ${classe}">
    <img src="/ranking/avatar/${encodeURIComponent(String(usuario.id))}" alt="Foto de ${esc(nome)}" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='grid'">
    <span class="avatar-fallback" style="display:none">${fallback}</span>
  </span>`;
}

function cardPodio(usuario, classe, medalha, posicao) {
  if (!usuario) return '<div class="pod placeholder"></div>';
  return `<article class="pod ${classe}">
    <div class="medal">${medalha}</div>
    <div class="place">${posicao}º lugar</div>
    ${avatar(usuario, "pod-avatar")}
    <strong class="pod-name">${esc(usuario.nome || "Torcedor")}</strong>
    <div class="pod-points"><b>${Number(usuario.pontos || 0)}</b><span>pontos</span></div>
  </article>`;
}

function partidasMarkup(partidas = []) {
  if (!partidas.length) {
    return '<div class="empty-history">Nenhuma partida detalhada registrada para este usuário.</div>';
  }

  return partidas.map((p, i) => `<article class="match">
    <div class="match-index">${String(i + 1).padStart(2, "0")}</div>
    <div class="match-info">
      <strong>${esc(p.confronto || "Partida")}</strong>
      <span>${esc(formatarData(p.resgatado_em))}</span>
    </div>
    <div class="match-score"><span>Placar</span><b>${esc(p.placar || "—")}</b></div>
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
    if (!fileId && token) {
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

    if (fileId && token) {
      const fileRes = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${encodeURIComponent(fileId)}`);
      const fileData = await fileRes.json();
      if (fileData?.ok && fileData.result?.file_path) {
        const imageRes = await fetch(`https://api.telegram.org/file/bot${token}/${fileData.result.file_path}`);
        if (imageRes.ok) {
          const headers = new Headers();
          headers.set("Content-Type", imageRes.headers.get("Content-Type") || "image/jpeg");
          headers.set("Cache-Control", "public, max-age=1800");
          headers.set("X-Content-Type-Options", "nosniff");
          return new Response(imageRes.body, { status: 200, headers });
        }
      }
    }
  } catch (error) {
    console.error("Erro ao carregar avatar do ranking", userId, error);
  }

  const texto = iniciais(user.nome || "Torcedor");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><rect width="120" height="120" rx="60" fill="#171b23"/><circle cx="60" cy="60" r="57" fill="none" stroke="#313846" stroke-width="3"/><text x="60" y="72" text-anchor="middle" font-family="Arial,sans-serif" font-size="38" font-weight="700" fill="#f8fafc">${esc(texto)}</text></svg>`;
  return new Response(svg, {
    status: 200,
    headers: { "Content-Type": "image/svg+xml; charset=utf-8", "Cache-Control": "public, max-age=600" }
  });
}

export async function renderRankingPage(request, env) {
  try {
    const { results: ranking = [] } = await env.DB.prepare(`
      SELECT u.id, u.nome, u.pontos
      FROM usuarios u
      WHERE u.pontos > 0
      ORDER BY u.pontos DESC, u.nome COLLATE NOCASE ASC, u.id ASC
    `).all();

    const { results: acertos = [] } = await env.DB.prepare(`
      SELECT a.user_id, a.postagem_id, a.confronto, a.placar, a.resgatado_em
      FROM acertos a
      INNER JOIN usuarios u ON u.id = a.user_id
      WHERE u.pontos > 0
      ORDER BY CAST(a.resgatado_em AS INTEGER) DESC, a.id DESC
    `).all();

    const porUsuario = new Map();
    for (const a of acertos) {
      const key = String(a.user_id);
      if (!porUsuario.has(key)) porUsuario.set(key, []);
      porUsuario.get(key).push(a);
    }

    const podium =
      cardPodio(ranking[1], "second", "🥈", 2) +
      cardPodio(ranking[0], "first", "🥇", 1) +
      cardPodio(ranking[2], "third", "🥉", 3);

    const linhasPontuacao = ranking.length
      ? ranking.map((u, i) => `<article class="score-row">
          <div class="position ${i === 0 ? "gold" : i === 1 ? "silver" : i === 2 ? "bronze" : ""}">${i + 1}</div>
          ${avatar(u, "list-avatar")}
          <div class="user-name"><strong>${esc(u.nome || "Torcedor")}</strong></div>
          <div class="points"><b>${Number(u.pontos || 0)}</b><span>pts</span></div>
        </article>`).join("")
      : '<div class="empty">Ainda não há pontuações no ranking.</div>';

    const linhasAcertos = ranking.length
      ? ranking.map((u, i) => {
          const partidas = porUsuario.get(String(u.id)) || [];
          return `<article class="history-card">
            <div class="history-head">
              <div class="history-user">
                ${avatar(u, "history-avatar")}
                <div><span>${i + 1}º NO RANKING</span><strong>${esc(u.nome || "Torcedor")}</strong><code>ID ${esc(String(u.id))}</code></div>
              </div>
              <div class="history-total"><b>${partidas.length}</b><span>acerto(s)</span></div>
            </div>
            <div class="history-list">${partidasMarkup(partidas)}</div>
          </article>`;
        }).join("")
      : '<div class="empty">Nenhum histórico disponível.</div>';

    const totalPontos = ranking.reduce((s, u) => s + Number(u.pontos || 0), 0);
    const html = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#08090c">
<title>Ranking Oficial • Gols Flamengo</title>
<style>
:root{--bg:#08090c;--surface:#101319;--surface2:#151922;--line:#252b36;--text:#f8f9fb;--muted:#9199a8;--red:#ef233c;--gold:#f6c453;--silver:#c7ced8;--bronze:#c98751;--shadow:0 22px 60px rgba(0,0,0,.38)}*{box-sizing:border-box}html{background:var(--bg)}body{margin:0;color:var(--text);font-family:Inter,system-ui,-apple-system,"Segoe UI",sans-serif;background:radial-gradient(900px 430px at 50% -160px,rgba(239,35,60,.26),transparent 68%),linear-gradient(180deg,#0d090b,#08090c 34%);min-height:100vh}.page{width:min(100%,920px);margin:auto;padding:0 16px 64px}.topbar{position:sticky;top:0;z-index:30;display:flex;align-items:center;justify-content:space-between;padding:14px 0;background:linear-gradient(180deg,rgba(8,9,12,.98),rgba(8,9,12,.88),transparent);backdrop-filter:blur(16px)}.brand{display:flex;gap:11px;align-items:center}.brand-mark{width:44px;height:44px;border-radius:15px;display:grid;place-items:center;background:linear-gradient(145deg,#f12742,#720814);font-size:20px}.brand strong{display:block;font-size:14px}.brand span{display:block;color:var(--muted);font-size:10px;margin-top:2px;text-transform:uppercase;letter-spacing:.08em}.refresh{color:#fff;text-decoration:none;background:#141821;border:1px solid var(--line);padding:10px 12px;border-radius:12px;font-size:12px;font-weight:800}.hero{padding:36px 0 24px}.hero .eyebrow{color:#ffadb7;font-size:11px;font-weight:900;letter-spacing:.15em}.hero h1{font-size:clamp(36px,7vw,62px);line-height:.97;letter-spacing:-2.5px;margin:10px 0 10px}.hero p{margin:0;color:var(--muted);font-size:14px;line-height:1.65}.summary{display:flex;gap:10px;margin-top:18px}.summary div{background:#11151c;border:1px solid var(--line);border-radius:14px;padding:11px 13px}.summary b{font-size:18px}.summary span{display:block;color:var(--muted);font-size:9px;text-transform:uppercase;margin-top:2px}.tabs{position:sticky;top:70px;z-index:20;display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:7px;background:rgba(12,14,19,.92);border:1px solid var(--line);border-radius:16px;backdrop-filter:blur(16px);margin-bottom:24px}.tab{border:0;background:transparent;color:var(--muted);padding:12px;border-radius:11px;font-weight:900;cursor:pointer}.tab.active{background:linear-gradient(180deg,#281318,#190d10);color:#fff;box-shadow:inset 0 0 0 1px #5a202a}.panel{display:none}.panel.active{display:block}.section-title{display:flex;justify-content:space-between;align-items:end;margin-bottom:13px}.section-title h2{margin:0;font-size:19px}.section-title span{color:var(--muted);font-size:11px}.podium{display:grid;grid-template-columns:1fr 1.08fr 1fr;align-items:end;gap:10px;margin-bottom:28px}.pod{position:relative;text-align:center;background:linear-gradient(180deg,#171b24,#0f1117);border:1px solid var(--line);border-radius:23px;padding:20px 9px 15px;min-width:0;box-shadow:var(--shadow)}.pod.first{min-height:240px;border-color:rgba(246,196,83,.48);background:linear-gradient(180deg,rgba(246,196,83,.1),#101218 48%)}.pod.second,.pod.third{min-height:210px}.pod.placeholder{visibility:hidden}.medal{position:absolute;top:8px;right:9px;font-size:27px}.place{font-size:9px;color:var(--muted);text-transform:uppercase;font-weight:900;letter-spacing:.14em;margin-bottom:15px}.avatar{position:relative;display:grid;place-items:center;overflow:hidden;border-radius:50%;background:#1d222c;flex:0 0 auto}.avatar img,.avatar-fallback{width:100%;height:100%;object-fit:cover;place-items:center}.pod-avatar{width:76px;height:76px;margin:0 auto 12px;border:3px solid rgba(255,255,255,.15)}.first .pod-avatar{width:94px;height:94px;border-color:var(--gold)}.second .pod-avatar{border-color:var(--silver)}.third .pod-avatar{border-color:var(--bronze)}.pod-name{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:14px}.pod-points{margin-top:10px}.pod-points b{font-size:29px}.pod-points span{display:block;color:var(--muted);font-size:9px;text-transform:uppercase}.ranking-list{background:rgba(14,16,21,.84);border:1px solid var(--line);border-radius:22px;padding:8px}.score-row{display:grid;grid-template-columns:42px 50px minmax(0,1fr) auto;gap:11px;align-items:center;padding:12px;border-bottom:1px solid #1c212b}.score-row:last-child{border-bottom:0}.position{width:34px;height:34px;border-radius:11px;display:grid;place-items:center;background:#171b23;color:#a9b0bc;font-weight:950}.position.gold{background:linear-gradient(145deg,#f7d777,#dcae37);color:#241a03}.position.silver{background:linear-gradient(145deg,#e6e9ef,#aeb6c2);color:#20242b}.position.bronze{background:linear-gradient(145deg,#e3a16c,#a96437);color:#24150d}.list-avatar{width:46px;height:46px;border:2px solid rgba(255,255,255,.11)}.user-name{min-width:0}.user-name strong{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:14px}.points{text-align:right}.points b{font-size:23px}.points span{display:block;color:var(--muted);font-size:9px}.history-grid{display:grid;gap:12px}.history-card{background:linear-gradient(180deg,#11141a,#0d1015);border:1px solid var(--line);border-radius:20px;overflow:hidden}.history-head{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:14px 15px;border-bottom:1px solid #1d222b}.history-user{display:flex;align-items:center;gap:11px;min-width:0}.history-avatar{width:50px;height:50px;border:2px solid rgba(255,255,255,.12)}.history-user div{min-width:0}.history-user span{display:block;color:#ff98a4;font-size:8px;font-weight:900;letter-spacing:.12em}.history-user strong{display:block;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:14px}.history-user code{display:block;color:var(--muted);font-size:9px;margin-top:3px}.history-total{text-align:right}.history-total b{display:block;font-size:20px}.history-total span{display:block;color:var(--muted);font-size:9px}.history-list{padding:10px;display:grid;gap:8px}.match{display:grid;grid-template-columns:34px minmax(0,1fr) auto;gap:10px;align-items:center;background:#0c0f14;border:1px solid #1c222b;border-radius:13px;padding:10px}.match-index{width:30px;height:30px;border-radius:9px;display:grid;place-items:center;background:#191e27;color:#9ca5b5;font-size:9px;font-weight:900}.match-info{min-width:0}.match-info strong{display:block;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.match-info span{display:block;color:var(--muted);font-size:9px;margin-top:4px}.match-score{text-align:right}.match-score span{display:block;color:var(--muted);font-size:8px}.match-score b{display:block;margin-top:3px;font-size:14px}.empty,.empty-history{padding:28px 16px;text-align:center;color:var(--muted);font-size:12px}.footer{text-align:center;color:#626977;font-size:10px;margin-top:24px}@media(max-width:560px){.page{padding:0 10px 44px}.brand span{display:none}.hero{padding-top:28px}.summary{display:grid;grid-template-columns:1fr 1fr}.podium{gap:5px}.pod{padding-left:5px;padding-right:5px}.pod.first{min-height:218px}.pod.second,.pod.third{min-height:192px}.pod-avatar{width:60px;height:60px}.first .pod-avatar{width:76px;height:76px}.pod-name{font-size:12px}.score-row{grid-template-columns:34px 44px minmax(0,1fr) auto;padding:10px 8px}.list-avatar{width:40px;height:40px}.history-head{padding:12px 10px}.match{grid-template-columns:30px minmax(0,1fr) auto;padding:9px 8px}.history-user code{font-size:8px}}
</style></head><body><main class="page">
<header class="topbar"><div class="brand"><div class="brand-mark">🔴⚫</div><div><strong>Gols Flamengo</strong><span>Ranking oficial</span></div></div><a class="refresh" href="/ranking">↻ Atualizar</a></header>
<section class="hero"><div class="eyebrow">🏆 BOLÃO GOLS FLAMENGO</div><h1>Ranking da Nação</h1><p>A primeira aba mostra somente a classificação e os pontos. Na segunda, você confere o histórico detalhado dos acertos.</p><div class="summary"><div><b>${ranking.length}</b><span>Torcedores</span></div><div><b>${totalPontos}</b><span>Pontos</span></div></div></section>
<nav class="tabs"><button class="tab active" data-tab="ranking">Pontuação</button><button class="tab" data-tab="acertos">Acertos</button></nav>
<section id="ranking" class="panel active"><div class="section-title"><h2>Pódio</h2><span>Top 3</span></div><div class="podium">${podium}</div><div class="section-title"><h2>Classificação geral</h2><span>Somente pontuação</span></div><div class="ranking-list">${linhasPontuacao}</div></section>
<section id="acertos" class="panel"><div class="section-title"><h2>Acertos por usuário</h2><span>Foto • ID • partidas</span></div><div class="history-grid">${linhasAcertos}</div></section>
<div class="footer">Gols Flamengo • Cloudflare Worker + D1</div>
</main><script>
const tabs=document.querySelectorAll('.tab');const panels=document.querySelectorAll('.panel');tabs.forEach(btn=>btn.addEventListener('click',()=>{tabs.forEach(x=>x.classList.remove('active'));panels.forEach(x=>x.classList.remove('active'));btn.classList.add('active');document.getElementById(btn.dataset.tab)?.classList.add('active');window.scrollTo({top:0,behavior:'smooth'});}));
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
