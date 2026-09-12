function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function cleanName(value) {
  return String(value || "Torcedor")
    .replace(/[\u0000-\u001F\u007F-\u009F\uFFFD]/g, "")
    .trim() || "Torcedor";
}

function initials(name) {
  return (cleanName(name).split(/\s+/).slice(0, 2).map((p) => p[0]).join("") || "T").toUpperCase();
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store, no-cache, must-revalidate",
    },
  });
}

async function getRanking(env) {
  const { results = [] } = await env.DB.prepare(`
    SELECT id, nome, pontos, foto_file_id, foto_url
    FROM usuarios
    WHERE pontos > 0
    ORDER BY pontos DESC, nome COLLATE NOCASE ASC, id ASC
  `).all();

  return await Promise.all(results.map(async (user, index) => {
    const { results: acertos = [] } = await env.DB.prepare(`
      SELECT confronto, placar, resgatado_em
      FROM acertos
      WHERE user_id = ?
      ORDER BY CAST(resgatado_em AS INTEGER) DESC, id DESC
    `).bind(user.id).all();

    const nome = cleanName(user.nome);
    return {
      id: String(user.id),
      uid: String(user.id),
      nome,
      name: nome,
      pontos: Number(user.pontos || 0),
      total: acertos.length,
      acertos: acertos.map((a) => `${a.confronto || "Partida"} -> ${a.placar || "Acerto"}`),
      historico_acertos: acertos,
      photo_file_id: user.foto_file_id || "",
      photo_url: user.foto_url || "",
      posicao: index + 1,
    };
  }));
}

function rankingSvg(ranking) {
  const top = ranking.slice(0, 10);
  const rows = top.map((item, index) => {
    const y = 300 + index * 84;
    const medal = index === 0 ? "🥇" : index === 1 ? "🥈" : index === 2 ? "🥉" : `#${index + 1}`;
    const barWidth = Math.max(70, Math.min(760, 90 + Number(item.pontos || 0) * 55));
    return `<g>
      <rect x="86" y="${y - 48}" width="1028" height="64" rx="20" fill="rgba(255,255,255,.045)" stroke="rgba(255,255,255,.08)"/>
      <rect x="86" y="${y + 8}" width="${barWidth}" height="4" rx="2" fill="#dc2626" opacity=".8"/>
      <text x="112" y="${y - 8}" font-family="Arial,sans-serif" font-size="24" font-weight="700" fill="#fff">${esc(medal)} ${esc(item.nome)}</text>
      <text x="1084" y="${y - 8}" text-anchor="end" font-family="Arial,sans-serif" font-size="24" font-weight="900" fill="#ffcc33">${Number(item.pontos || 0)} pts</text>
    </g>`;
  }).join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1350" viewBox="0 0 1200 1350">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#09090b"/><stop offset=".48" stop-color="#170505"/><stop offset="1" stop-color="#000"/></linearGradient>
      <radialGradient id="glow"><stop stop-color="#dc2626" stop-opacity=".24"/><stop offset="1" stop-color="#dc2626" stop-opacity="0"/></radialGradient>
      <pattern id="grid" width="44" height="44" patternUnits="userSpaceOnUse"><path d="M44 0H0V44" fill="none" stroke="#fff" stroke-opacity=".025"/></pattern>
    </defs>
    <rect width="1200" height="1350" fill="url(#bg)"/>
    <rect width="1200" height="1350" fill="url(#grid)"/>
    <circle cx="1050" cy="90" r="400" fill="url(#glow)"/>
    <text x="72" y="110" font-family="Arial,sans-serif" font-size="30" font-weight="900" fill="#ef4444">📊 Classificação Geral</text>
    <text x="72" y="186" font-family="Arial,sans-serif" font-size="58" font-weight="900" fill="#fff">Ranking do Bolão do Mengão ❤️🖤</text>
    <text x="72" y="235" font-family="Arial,sans-serif" font-size="24" fill="rgba(255,255,255,.72)">Top 10 torcedores com mais pontos no bolão oficial.</text>
    <rect x="56" y="260" width="1088" height="970" rx="36" fill="#18181b" fill-opacity=".9" stroke="#ef4444" stroke-opacity=".28" stroke-width="2"/>
    ${rows}
    <text x="600" y="1285" text-anchor="middle" font-family="Arial,sans-serif" font-size="22" font-weight="700" fill="rgba(255,255,255,.55)">FLAMENGO GOLS • BOLÃO ABERTO DA NAÇÃO</text>
  </svg>`;
}

function faviconSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#ef233c"/><stop offset="1" stop-color="#740814"/></linearGradient></defs>
    <rect width="128" height="128" rx="30" fill="url(#g)"/>
    <circle cx="45" cy="64" r="28" fill="#ff1744"/>
    <circle cx="83" cy="64" r="28" fill="#20242b" stroke="#111" stroke-width="4"/>
  </svg>`;
}

export function renderWorkerFavicon() {
  return new Response(faviconSvg(), {
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": "public, max-age=86400",
    },
  });
}

export async function processarCompatApi(request, env) {
  const url = new URL(request.url);

  if (url.pathname === "/api/ranking" && request.method === "GET") {
    return json({ ok: true, ranking: await getRanking(env) });
  }

  if (url.pathname === "/api/avatar" && request.method === "GET") {
    const uid = url.searchParams.get("uid") || url.searchParams.get("id");
    if (uid && /^\d+$/.test(uid)) {
      return Response.redirect(`${url.origin}/ranking/avatar/${uid}`, 302);
    }

    const fileId = url.searchParams.get("file_id");
    if (fileId) {
      const user = await env.DB.prepare("SELECT id FROM usuarios WHERE foto_file_id = ? LIMIT 1").bind(fileId).first();
      if (user?.id) return Response.redirect(`${url.origin}/ranking/avatar/${user.id}`, 302);
    }

    const name = cleanName(url.searchParams.get("name") || "Torcedor");
    const fallback = `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240" viewBox="0 0 240 240"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#e50914"/><stop offset="1" stop-color="#111"/></linearGradient></defs><rect width="240" height="240" rx="120" fill="url(#g)"/><text x="120" y="138" text-anchor="middle" font-family="Arial,sans-serif" font-size="70" font-weight="900" fill="#fff">${esc(initials(name))}</text></svg>`;
    return new Response(fallback, { headers: { "Content-Type": "image/svg+xml; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
  }

  if (url.pathname === "/api/ranking-image" && request.method === "GET") {
    const ranking = await getRanking(env);
    return new Response(rankingSvg(ranking), {
      headers: {
        "Content-Type": "image/svg+xml; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  }

  return null;
}
