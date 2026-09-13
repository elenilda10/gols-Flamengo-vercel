import { deleteGoal, getGoal, saveGoal } from "../services/goals.js";
import { telegramRequest } from "../services/telegram.js";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS"
    }
  });
}

function adminPermitido(env, body) {
  const esperado = String(env?.ADMIN_TELEGRAM_ID || "7717528550");
  return String(body?.admin_id || "") === esperado;
}

async function enviarBackup(env, gol) {
  const chatId = String(env?.GOALS_BACKUP_CHANNEL || "-1003703318973");
  const status = gol.editing ? "📝 Gol editado e modificado" : "📌 Novo gol adicionado";

  try {
    await telegramRequest(env, "sendVideo", {
      chat_id: chatId,
      video: gol.file_id,
      caption:
        `📌 <b>${status} via Painel Web</b>\n\n` +
        `🆔 <code>${gol.id}</code>\n` +
        `⚽ ${gol.jogo}\n\n` +
        `#⃣ Autor: ${gol.autor}\n` +
        `🅰 Assistência: ${gol.assistencia}\n` +
        `🏆 ${gol.campeonato} - ${gol.fase}`,
      parse_mode: "HTML"
    });
  } catch (error) {
    console.error("backupGol", error);
  }
}

export async function processarGolsApi(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;

  if (!["/api/getgoal", "/api/addgoal-action", "/api/deletegoal"].includes(path)) {
    return null;
  }

  if (request.method === "OPTIONS") return json({ ok: true });

  if (path === "/api/getgoal" && request.method === "GET") {
    try {
      const id = url.searchParams.get("id");
      if (!id) return json({ ok: false, error: "id_missing" }, 400);

      const gol = await getGoal(env.DB, id);
      if (!gol) return json({ ok: false, error: "not_found" }, 404);

      return json({ ok: true, gol });
    } catch (error) {
      return json({ ok: false, error: error.message }, 500);
    }
  }

  if (path === "/api/deletegoal" && request.method === "DELETE") {
    try {
      const id = url.searchParams.get("id");
      if (!id) return json({ ok: false, error: "id_missing" }, 400);

      await deleteGoal(env.DB, id);
      return json({ ok: true, mensagem: "Excluído com sucesso do D1." });
    } catch (error) {
      return json({ ok: false, error: error.message }, 500);
    }
  }

  if (path === "/api/addgoal-action" && request.method === "POST") {
    try {
      const body = await request.json();
      if (!adminPermitido(env, body)) {
        return json({ ok: false, error: "Acesso Negado." }, 401);
      }

      const gol = await saveGoal(env.DB, body);
      await enviarBackup(env, gol);
      return json({ ok: true, id: gol.id });
    } catch (error) {
      return json({ ok: false, error: error.message }, 500);
    }
  }

  return json({ ok: false, error: "method_not_allowed" }, 405);
}
