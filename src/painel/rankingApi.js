import { json } from "./config.js";

function sanitizarNome(str) {
  if (!str) return "Torcedor";
  return String(str).replace(/[\u0000-\u001F\u007F-\u009F\uFFFD]/g, "").trim() || "Torcedor";
}

export async function processarRankingApi(request, env) {
  const url = new URL(request.url);
  const botToken = env.TELEGRAM_TOKEN || env.TELEGRAM_BOT_TOKEN;

  if (url.pathname === "/api/ranking_api") {
    try {
      const { results: usuarios = [] } = await env.DB.prepare(`
        SELECT id, nome, pontos, foto_url
        FROM usuarios
        WHERE pontos > 0
        ORDER BY pontos DESC
      `).all();

      const ranking = await Promise.all(usuarios.map(async (u) => {
        const uid = String(u.id);
        let finalPhotoUrl = u.foto_url || "";
        let fileId = "";

        if (!finalPhotoUrl && botToken) {
          try {
            const photosRes = await fetch(`https://api.telegram.org/bot${botToken}/getUserProfilePhotos?user_id=${uid}&limit=1`);
            const photosData = await photosRes.json();
            if (photosData.ok && photosData.result?.photos?.length > 0) {
              fileId = photosData.result.photos[0][0].file_id;
              const fileRes = await fetch(`https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`);
              const fileData = await fileRes.json();
              if (fileData.ok && fileData.result?.file_path) {
                finalPhotoUrl = `https://api.telegram.org/file/bot${botToken}/${fileData.result.file_path}`;
                await env.DB.prepare("UPDATE usuarios SET foto_url = ?, foto_file_id = ? WHERE id = ?").bind(finalPhotoUrl, fileId, u.id).run();
              }
            }
          } catch {}
        }

        const nome = sanitizarNome(u.nome);
        if (!finalPhotoUrl) {
          finalPhotoUrl = `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(nome)}&backgroundColor=dc2626&textColor=ffffff&bold=true`;
        }

        const { results: acertos = [] } = await env.DB.prepare(`
          SELECT confronto, placar, resgatado_em
          FROM acertos
          WHERE user_id = ?
          ORDER BY CAST(resgatado_em AS INTEGER) DESC
        `).bind(u.id).all();

        return {
          id: uid,
          uid,
          nome,
          name: nome,
          pontos: u.pontos,
          total: u.pontos,
          acertos: acertos.map(a => `${a.confronto} -> ${a.placar}`),
          historico_acertos: acertos,
          photo_url: finalPhotoUrl,
          photo_file_id: fileId || finalPhotoUrl
        };
      }));

      return json({ ok: true, ranking });
    } catch (error) {
      return json({ ok: false, error: error.message }, 500);
    }
  }

  if (url.pathname === "/api/ranking_user_public_api") {
    try {
      let uid = url.searchParams.get("uid") || url.searchParams.get("id");
      if (!uid) return json({ ok: false, error: "uid_missing" }, 400);
      uid = Number(uid);

      const user = await env.DB.prepare("SELECT id, nome, pontos, foto_url FROM usuarios WHERE id = ?").bind(uid).first();
      if (!user) return json({ ok: false, error: "user_not_found" }, 404);

      const posicaoRow = await env.DB.prepare("SELECT COUNT(*) + 1 AS pos FROM usuarios WHERE pontos > ?").bind(user.pontos).first();
      const { results: acertos = [] } = await env.DB.prepare(`
        SELECT confronto, placar, resgatado_em
        FROM acertos
        WHERE user_id = ?
        ORDER BY CAST(resgatado_em AS INTEGER) DESC
      `).bind(uid).all();

      let photoUrl = user.foto_url || "";
      if (!photoUrl) {
        photoUrl = `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(user.nome || "Torcedor")}&backgroundColor=dc2626&textColor=ffffff&bold=true`;
      }

      return json({
        ok: true,
        uid: String(user.id),
        id: String(user.id),
        nome: user.nome || "Torcedor",
        pontos: user.pontos || 0,
        total: user.pontos || 0,
        posicao: posicaoRow?.pos || 1,
        acertos: acertos.map(a => `${a.confronto} -> ${a.placar}`),
        historico: acertos,
        photo_url: photoUrl
      });
    } catch (error) {
      return json({ ok: false, error: error.message }, 500);
    }
  }

  return null;
}
