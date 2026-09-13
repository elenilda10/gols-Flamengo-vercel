import { json } from "./config.js";

export async function processarMigrationApi(request, env) {
  const url = new URL(request.url);
  if (url.pathname !== "/api/migrar-tudo" || request.method !== "GET") return null;

  try {
    const cursor = url.searchParams.get("cursor") || "";
    const tipo = url.searchParams.get("tipo") || "acertos";
    let prefixo = "acertos_";
    if (tipo === "resgates") prefixo = "resgate_concluido_";
    if (tipo === "usuarios") prefixo = "user_";

    if (!env.GOLS_FLAMENGO_KV) return json({ ok: false, error: "GOLS_FLAMENGO_KV não configurado" }, 500);

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
            await env.DB.prepare("INSERT OR IGNORE INTO usuarios (id, nome, criado_em) VALUES (?, 'Torcedor', ?)").bind(uid, Date.now()).run();
            await env.DB.prepare("INSERT OR IGNORE INTO boloes (postagem_id, confronto, criado_em) VALUES (?, 'Histórico', ?)").bind(postId, Date.now()).run();
            await env.DB.prepare(`INSERT OR IGNORE INTO acertos (postagem_id, user_id, confronto, placar, resgatado, resgatado_em) VALUES (?, ?, 'Bolão Oficial', 'Acerto Confirmado', 1, ?)`).bind(postId, uid, Date.now()).run();
            processados++;
          }
          continue;
        }

        if (tipo === "usuarios") {
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
          continue;
        }

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
          continue;
        }

        const uid = Number(chave.replace("acertos_", ""));
        if (uid <= 0) continue;
        let itens;
        try {
          itens = JSON.parse(raw);
          if (typeof itens === "string") itens = [itens];
          if (!Array.isArray(itens)) itens = [];
        } catch {
          itens = [raw];
        }

        await env.DB.prepare("INSERT OR IGNORE INTO usuarios (id, nome, criado_em) VALUES (?, 'Torcedor', ?)").bind(uid, Date.now()).run();
        for (const item of itens) {
          const partes = String(item).split("->");
          const confronto = partes[0]?.trim() || String(item);
          const placar = partes[1]?.trim() || "Placar Correto";
          const postId = "migrado_" + Math.random().toString(36).substring(2, 9);
          await env.DB.prepare("INSERT OR IGNORE INTO boloes (postagem_id, confronto, criado_em) VALUES (?, ?, ?)").bind(postId, confronto, Date.now()).run();
          await env.DB.prepare(`INSERT OR IGNORE INTO acertos (postagem_id, user_id, confronto, placar, resgatado, resgatado_em) VALUES (?, ?, ?, ?, 1, ?)`).bind(postId, uid, confronto, placar, Date.now()).run();
          processados++;
        }
      } catch (error) {
        console.error("migration item", chave, error);
      }
    }

    return json({ ok: true, tipo, processados_neste_lote: processados, concluido: lista.list_complete, proximo_cursor: lista.cursor || null });
  } catch (error) {
    return json({ ok: false, error: error.message }, 500);
  }
}
