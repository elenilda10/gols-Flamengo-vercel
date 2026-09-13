import { json } from "./config.js";

export async function processarUsersApi(request, env) {
  const url = new URL(request.url);

  if (url.pathname === "/api/get-user-details" && request.method === "GET") {
    try {
      const uidRaw = url.searchParams.get("uid");
      if (!uidRaw) return json({ ok: false }, 400);
      const uid = Number(uidRaw);
      const user = await env.DB.prepare("SELECT id, nome, pontos FROM usuarios WHERE id = ?").bind(uid).first();
      if (!user) return json({ ok: false, error: "not_found" }, 404);
      return json({ ok: true, nome: user.nome || "Torcedor", pontos: user.pontos || 0 });
    } catch (error) {
      return json({ ok: false, error: error.message }, 500);
    }
  }

  if (url.pathname === "/api/save-user-details" && request.method === "POST") {
    try {
      const body = await request.json();
      const { uid, nome, pontos } = body;
      if (!uid) return json({ ok: false }, 400);

      await env.DB.prepare(`
        INSERT INTO usuarios (id, nome, pontos, criado_em)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET nome = ?, pontos = ?
      `).bind(Number(uid), nome || "Torcedor", Number(pontos) || 0, Date.now(), nome || "Torcedor", Number(pontos) || 0).run();

      return json({ ok: true });
    } catch (error) {
      return json({ ok: false, error: error.message }, 500);
    }
  }

  return null;
}
