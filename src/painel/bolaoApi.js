import { deleteConfig, getConfig, json, setConfig } from "./config.js";

const BOLAO_PATHS = new Set([
  "/api/bolao-toggle",
  "/api/bolao-vincular",
  "/api/bolao-vencedores-update",
  "/api/bolao-iniciar-web",
  "/api/bolao-encerrar-web",
  "/api/processar-bolao"
]);

function botToken(env) {
  return env.TELEGRAM_TOKEN || env.TELEGRAM_BOT_TOKEN || "";
}

async function telegram(env, method, payload) {
  const token = botToken(env);
  if (!token) throw new Error("TELEGRAM_TOKEN não configurado");
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await res.json();
  if (!res.ok || !data?.ok) throw new Error(data?.description || `Telegram ${method} falhou`);
  return data.result;
}

function formatarTimes(txt) {
  return String(txt || "").toLowerCase().replace(/\b\w/g, (l) => l.toUpperCase());
}

export async function processarBolaoApi(request, env) {
  const url = new URL(request.url);
  if (!BOLAO_PATHS.has(url.pathname)) return null;
  if (request.method === "OPTIONS") return json({ ok: true });

  if (url.pathname === "/api/bolao-toggle" && request.method === "POST") {
    const status = url.searchParams.get("status") || "false";
    await setConfig(env.DB, "bolao_aberto", status);
    return json({ ok: true });
  }

  if (url.pathname === "/api/bolao-vincular" && request.method === "POST") {
    try {
      const body = await request.json();
      const postId = String(body.post_id || "").trim();
      const confronto = String(body.confronto || "").trim();
      if (!postId) return json({ ok: false, error: "post_id_missing" }, 400);

      await setConfig(env.DB, "postagem_ativa_id", postId);
      await setConfig(env.DB, "bolao_aberto", "true");
      if (confronto) {
        await setConfig(env.DB, "confronto_atual", confronto);
        await setConfig(env.DB, "confronto_" + postId, confronto);
      }
      return json({ ok: true });
    } catch (error) {
      return json({ ok: false, error: error.message }, 500);
    }
  }

  if (url.pathname === "/api/bolao-vencedores-update" && request.method === "POST") {
    try {
      const body = await request.json();
      await setConfig(env.DB, "vencedores_temporarios", body.texto || "");
      return json({ ok: true });
    } catch (error) {
      return json({ ok: false, error: error.message }, 500);
    }
  }

  if (url.pathname === "/api/bolao-iniciar-web" && request.method === "POST") {
    try {
      const body = await request.json();
      const infoJogo = formatarTimes(String(body.confronto || "").trim());
      const fotoId = String(body.foto || "").trim();
      if (!infoJogo || !fotoId) return json({ ok: false, error: "dados_incompletos" }, 400);

      await deleteConfig(env.DB, "postagem_ativa_id");
      await setConfig(env.DB, "vencedores_temporarios", "");

      const confrontoLimpo = infoJogo.replace(/\d{1,2}H\d{0,2}/gi, "").replace(/\d{1,2}:\d{2}/g, "").trim();
      const partes = confrontoLimpo.split(/\s+x\s+/i);
      const timeCasa = partes[0]?.trim() || "Time 1";
      const timeFora = partes[1]?.trim() || "Time 2";

      const legenda =
        "🏟 <b>BOLÃO DO MENGÃO</b> 🔴⚫\n\n" +
        `🔥 <b>PARTIDA:</b>\n<b>${infoJogo}</b>\n\n` +
        "💬 <b>COMO PARTICIPAR:</b>\nClique em <b>“Escrever um comentário”</b> e envie seu palpite.\n\n" +
        "<blockquote expandable>" +
        "📌 <b>LEIA ANTES DE PALPITAR</b>\n\n" +
        `O placar deve seguir exatamente a ordem da partida:\n<b>${timeCasa} X ${timeFora}</b>\n\n` +
        "Exemplos:\n• <b>2x1</b>\n• <b>1x1</b>\n\n" +
        "⚠️ <b>REGRAS:</b> Apenas 1 palpite por usuário. Editou perde a validação. Palpites após o início não contam." +
        "</blockquote>\n\n" +
        "🏆 Vale <b>1 ponto</b> no ranking!";

      await setConfig(env.DB, "confronto_atual", infoJogo);
      await setConfig(env.DB, "bolao_aberto", "true");

      const post = await telegram(env, "sendPhoto", {
        chat_id: "@Flamengo77",
        photo: fotoId,
        caption: legenda,
        parse_mode: "HTML"
      });

      const postId = String(post.message_id);
      await setConfig(env.DB, "postagem_ativa_id", postId);
      await setConfig(env.DB, "confronto_" + postId, infoJogo);
      await env.DB.prepare(`
        INSERT INTO boloes (postagem_id, confronto, criado_em)
        VALUES (?, ?, ?)
        ON CONFLICT(postagem_id) DO UPDATE SET confronto = excluded.confronto
      `).bind(postId, infoJogo, Date.now()).run();

      return json({ ok: true, id: postId });
    } catch (error) {
      return json({ ok: false, error: error.message }, 500);
    }
  }

  if (url.pathname === "/api/bolao-encerrar-web" && request.method === "POST") {
    try {
      const body = await request.json();
      const placar = String(body.placar || "").trim();
      const foto = String(body.foto || "").trim();
      if (!placar) return json({ ok: false, error: "placar_missing" }, 400);

      const postId = await getConfig(env.DB, "postagem_ativa_id");
      if (!postId) return json({ ok: false, error: "Nenhum bolão ativo encontrado no D1." }, 400);

      const confronto = (await getConfig(env.DB, "confronto_" + postId)) || (await getConfig(env.DB, "confronto_atual")) || "FLAMENGO";
      const { results: vencedores = [] } = await env.DB.prepare(`
        SELECT user_id FROM palpites
        WHERE postagem_id = ? AND LOWER(TRIM(palpite)) = LOWER(TRIM(?))
      `).bind(postId, placar).all();
      const ids = vencedores.map((v) => String(v.user_id));

      if (ids.length) {
        const placeholders = ids.map(() => "?").join(",");
        await env.DB.prepare(`UPDATE usuarios SET pontos = pontos + 1 WHERE id IN (${placeholders})`).bind(...ids).run();
        for (const id of ids) {
          await env.DB.prepare(`
            INSERT INTO acertos (postagem_id, user_id, confronto, placar, resgatado, resgatado_em)
            VALUES (?, ?, ?, ?, 1, ?)
            ON CONFLICT(postagem_id, user_id) DO UPDATE SET
              confronto = excluded.confronto,
              placar = excluded.placar,
              resgatado = 1,
              resgatado_em = excluded.resgatado_em
          `).bind(postId, Number(id), confronto, placar, Date.now()).run();
        }
      }

      await setConfig(env.DB, "vencedores_ids_" + postId, JSON.stringify(ids));
      const vencedoresTexto = (await getConfig(env.DB, "vencedores_temporarios")) || (ids.length ? `🎉 ${ids.length} torcedor(es) acertaram o placar!` : "Nenhum vencedor registrado.");
      const legenda = `🏆 <b>RESULTADO DO BOLÃO</b> 🏆\n\n⚽ Jogo: <b>${confronto}</b>\n📊 Resultado: <b>${placar}</b>\n\n🥇 Ganhador(es):\n${vencedoresTexto}\n\n🎁 Resgate seu ponto no botão abaixo!`;
      const replyMarkup = { inline_keyboard: [[{ text: "🥇 RESGATAR MEU PONTO", url: `https://t.me/FlamengoGolsBot?start=resgatar_${postId}` }]] };

      if (foto) {
        await telegram(env, "sendPhoto", { chat_id: "@Flamengo77", photo: foto, caption: legenda, parse_mode: "HTML", reply_markup: replyMarkup });
      } else {
        await telegram(env, "sendMessage", { chat_id: "@Flamengo77", text: legenda, reply_to_message_id: Number(postId), parse_mode: "HTML", disable_web_page_preview: true, reply_markup: replyMarkup });
      }

      await setConfig(env.DB, "resultado_oficial_" + postId, placar);
      await setConfig(env.DB, "bolao_encerrado_em_" + postId, String(Date.now()));
      await setConfig(env.DB, "bolao_aberto", "false");
      await setConfig(env.DB, "vencedores_temporarios", "");
      await deleteConfig(env.DB, "postagem_ativa_id");
      return json({ ok: true });
    } catch (error) {
      return json({ ok: false, error: error.message }, 500);
    }
  }

  if (url.pathname === "/api/processar-bolao" && request.method === "POST") {
    try {
      const data = await request.json();
      const postId = String(data.post_id || "");
      const userId = Number(data.user_id || 0);
      const original = String(data.texto_bruto || "").trim();

      const status = await getConfig(env.DB, "bolao_aberto");
      if (status !== "true") {
        await telegram(env, "sendMessage", {
          chat_id: data.chat_id,
          reply_to_message_id: Number(data.message_id),
          parse_mode: "Markdown",
          text: "⛔ *Palpites encerrados!*\n\nO bolão já foi fechado para esse jogo. Aguarde a próxima rodada! 🔴⚫"
        });
        return json({ ok: false, error: "fechado" });
      }

      const existente = await env.DB.prepare("SELECT palpite FROM palpites WHERE postagem_id = ? AND user_id = ?").bind(postId, userId).first();
      if (existente) {
        await telegram(env, "sendMessage", {
          chat_id: data.chat_id,
          reply_to_message_id: Number(data.message_id),
          parse_mode: "Markdown",
          text: `⚠️ *Você já enviou um palpite!*\n\n📌 Seu palpite registrado: *${existente.palpite}*\n\n• Não é permitido alterar ou enviar múltiplos palpites.`
        });
        return json({ ok: false, error: "duplicado" });
      }

      const limpo = original.replace(/×/g, "x").replace(/X/g, "x").replace(/–|—/g, "-").replace(/\s+/g, " ").trim();
      const direto = limpo.match(/(?:^|\D)(\d{1,2})\s*(?:x|-|a)\s*(\d{1,2})(?:\D|$)/i);
      let casa = "";
      let fora = "";
      if (direto) {
        casa = direto[1];
        fora = direto[2];
      } else {
        const semHorario = limpo.replace(/\b\d{1,2}\s*h\s*\d{0,2}\b/gi, " ").replace(/\b\d{1,2}:\d{2}\b/g, " ").replace(/\s+/g, " ").trim();
        const comTimes = semHorario.match(/(?:^|[\s.,;:!?])([A-Za-zÀ-ÿ.' -]{2,40})\s+(\d{1,2})\s+([A-Za-zÀ-ÿ.' -]{2,40})\s+(\d{1,2})(?:$|[\s.,;:!?])/i);
        if (comTimes) {
          casa = comTimes[2];
          fora = comTimes[4];
        } else {
          const numeros = semHorario.match(/\b\d{1,2}\b/g);
          if (numeros?.length === 2) [casa, fora] = numeros;
        }
      }

      if (!casa || !fora) {
        await telegram(env, "sendMessage", {
          chat_id: data.chat_id,
          reply_to_message_id: Number(data.message_id),
          parse_mode: "HTML",
          text: "❌ <b>Formato de palpite inválido!</b>\n\n<blockquote>📌 Envie um placar inteligível. Exemplos:\n• 2x1\n• Flamengo 3x0 Coritiba</blockquote>"
        });
        return json({ ok: false, error: "invalido" });
      }

      const palpite = `${casa}x${fora}`;
      await env.DB.prepare(`
        INSERT INTO usuarios (id, nome, criado_em)
        VALUES (?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET nome = excluded.nome
      `).bind(userId, data.first_name || "Torcedor", Date.now()).run();
      await env.DB.prepare(`
        INSERT INTO palpites (postagem_id, user_id, palpite, criado_em)
        VALUES (?, ?, ?, ?)
      `).bind(postId, userId, palpite, Date.now()).run();
      await telegram(env, "setMessageReaction", {
        chat_id: data.chat_id,
        message_id: Number(data.message_id),
        reaction: [{ type: "emoji", emoji: "👍" }]
      });
      return json({ ok: true });
    } catch (error) {
      return json({ ok: false, error: error.message }, 500);
    }
  }

  return json({ ok: false, error: "method_not_allowed" }, 405);
}
