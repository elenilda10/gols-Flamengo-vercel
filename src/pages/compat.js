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

async function proxyImage(imageUrl) {
  try {
    const res = await fetch(imageUrl, {
      cache: "no-store",
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    if (!res.ok) return null;
    const headers = new Headers();
    headers.set("Content-Type", res.headers.get("Content-Type") || "image/jpeg");
    headers.set("Content-Disposition", "inline");
    headers.set("Cache-Control", "public, max-age=1800");
    headers.set("X-Content-Type-Options", "nosniff");
    return new Response(res.body, { status: 200, headers });
  } catch {
    return null;
  }
}

async function telegramImageByFileId(fileId, env) {
  const token = env.TELEGRAM_TOKEN || env.TELEGRAM_BOT_TOKEN;
  if (!token || !fileId) return null;
  try {
    const getFile = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${encodeURIComponent(fileId)}`, { cache: "no-store" });
    if (!getFile.ok) return null;
    const data = await getFile.json();
    if (!data?.ok || !data.result?.file_path) return null;
    return await proxyImage(`https://api.telegram.org/file/bot${token}/${data.result.file_path}`);
  } catch {
    return null;
  }
}

function fallbackAvatar(name) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240" viewBox="0 0 240 240"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#e50914"/><stop offset="1" stop-color="#111"/></linearGradient></defs><rect width="240" height="240" rx="120" fill="url(#g)"/><circle cx="120" cy="120" r="106" fill="none" stroke="rgba(255,255,255,.22)" stroke-width="4"/><text x="120" y="138" text-anchor="middle" font-family="Arial,sans-serif" font-size="70" font-weight="900" fill="#fff">${esc(initials(name))}</text></svg>`;
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
  return `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#ef233c"/><stop offset="1" stop-color="#740814"/></linearGradient></defs><rect width="128" height="128" rx="30" fill="url(#g)"/><circle cx="45" cy="64" r="28" fill="#ff1744"/><circle cx="83" cy="64" r="28" fill="#20242b" stroke="#111" stroke-width="4"/></svg>`;
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
    const fileId = url.searchParams.get("file_id") || "";
    let name = cleanName(url.searchParams.get("name") || "Torcedor");

    if (uid && /^\d+$/.test(uid)) {
      const user = await env.DB.prepare("SELECT nome, foto_url, foto_file_id FROM usuarios WHERE id = ? LIMIT 1").bind(Number(uid)).first();
      if (user) {
        name = cleanName(user.nome || name);
        if (user.foto_url && /^https?:\/\//i.test(user.foto_url) && !user.foto_url.includes("dicebear")) {
          const image = await proxyImage(user.foto_url);
          if (image) return image;
        }
        if (user.foto_file_id) {
          const image = await telegramImageByFileId(user.foto_file_id, env);
          if (image) return image;
        }
      }

      const token = env.TELEGRAM_TOKEN || env.TELEGRAM_BOT_TOKEN;
      if (token) {
        try {
          const photosRes = await fetch(`https://api.telegram.org/bot${token}/getUserProfilePhotos?user_id=${uid}&limit=1`, { cache: "no-store" });
          const photos = await photosRes.json();
          const sizes = photos?.result?.photos?.[0] || [];
          const newest = sizes[sizes.length - 1] || sizes[0];
          if (photos?.ok && newest?.file_id) {
            const image = await telegramImageByFileId(newest.file_id, env);
            if (image) {
              try { await env.DB.prepare("UPDATE usuarios SET foto_file_id = ? WHERE id = ?").bind(newest.file_id, Number(uid)).run(); } catch {}
              return image;
            }
          }
        } catch {}
      }
    }

    if (fileId) {
      if (/^https?:\/\//i.test(fileId)) {
        const image = await proxyImage(fileId);
        if (image) return image;
      }

      const user = await env.DB.prepare("SELECT id, nome, foto_url FROM usuarios WHERE foto_file_id = ? LIMIT 1").bind(fileId).first();
      if (user) {
        name = cleanName(user.nome || name);
        if (user.foto_url && /^https?:\/\//i.test(user.foto_url) && !user.foto_url.includes("dicebear")) {
          const image = await proxyImage(user.foto_url);
          if (image) return image;
        }
      }

      const image = await telegramImageByFileId(fileId, env);
      if (image) return image;
    }

    return new Response(fallbackAvatar(name), {
      headers: {
        "Content-Type": "image/svg+xml; charset=utf-8",
        "Cache-Control": "public, max-age=3600",
      },
    });
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
