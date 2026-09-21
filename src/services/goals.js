export function normalizeGoalSearch(text) {
  if (!text) return "";

  let value = String(text).toLowerCase().trim();
  try {
    value = value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  } catch {}

  return value
    .replace(/@flamengogolsbot/gi, "")
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export async function searchGoals(db, query, { limit = 50, offset = 0 } = {}) {
  const normalized = normalizeGoalSearch(query);
  if (!normalized) return [];

  const term = `%${normalized}%`;
  const { results = [] } = await db.prepare(`
    SELECT * FROM gols
    WHERE jogo LIKE ? OR autor LIKE ? OR assistencia LIKE ? OR campeonato LIKE ? OR fase LIKE ?
    ORDER BY CAST(criado_em AS INTEGER) DESC, CAST(id AS INTEGER) DESC
    LIMIT ? OFFSET ?
  `).bind(term, term, term, term, term, limit, offset).all();

  return results;
}

export async function getGoal(db, id) {
  if (!id) return null;
  return db.prepare("SELECT * FROM gols WHERE id = ?").bind(String(id)).first();
}

export async function saveGoal(db, payload) {
  const requestedId = String(payload?.id || "").trim();
  const id = requestedId || String(Date.now());
  const existing = requestedId
    ? await db.prepare("SELECT id FROM gols WHERE id = ?").bind(requestedId).first()
    : null;
  const editing = Boolean(existing);
  const fileId = String(payload?.file_id || "").trim();
  const jogo = String(payload?.jogo || "").trim();
  const autor = String(payload?.autor || "").trim();
  const assistencia = String(payload?.assistencia || "").trim();
  const campeonato = String(payload?.campeonato || "").trim();
  const fase = String(payload?.fase || "").trim();

  if (!fileId || !jogo || !autor || !assistencia || !campeonato || !fase) {
    throw new Error("Campos obrigatórios ausentes.");
  }

  await db.prepare(`
    INSERT INTO gols (id, file_id, jogo, autor, assistencia, campeonato, fase, criado_em)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      file_id = excluded.file_id,
      jogo = excluded.jogo,
      autor = excluded.autor,
      assistencia = excluded.assistencia,
      campeonato = excluded.campeonato,
      fase = excluded.fase
  `).bind(id, fileId, jogo, autor, assistencia, campeonato, fase, Date.now()).run();

  return { id, editing, file_id: fileId, jogo, autor, assistencia, campeonato, fase };
}

export async function deleteGoal(db, id) {
  if (!id) throw new Error("id_missing");
  return db.prepare("DELETE FROM gols WHERE id = ?").bind(String(id)).run();
}

export function goalToInlineResult(goal, offset = 0) {
  return {
    type: "video",
    id: `vid_${goal.id}_${offset}`,
    video_file_id: goal.file_id,
    title: goal.jogo || "Gol",
    description: `⚽️ ${goal.autor || "-"} | 🏆 ${goal.campeonato || "-"}`,
    caption: `<b>${goal.jogo || ""}</b>\n\n⚽️ ${goal.autor || "-"}\n🅰 ${goal.assistencia || "-"}\n\n🏆 ${goal.campeonato || "-"} - ${goal.fase || "-"}\n\n🤖 @FlamengoGolsBot`,
    parse_mode: "HTML"
  };
}
