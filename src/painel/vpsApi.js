import { getGoal, saveGoal, deleteGoal, searchGoals } from "../services/goals.js";

const PREFIX = "/api/vps";
const API_DIAGNOSTIC_VERSION = "vps-route-diag-20260921-1";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

function timingSafeEqual(a, b) {
  const x = String(a || "");
  const y = String(b || "");
  if (!x || x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

function clientIp(request) {
  return String(request.headers.get("CF-Connecting-IP") || "").trim();
}

function allowedIps(env) {
  return [
    String(env.VPS_ALLOWED_IP || "").trim(),
    String(env.VPS_ALLOWED_IPV6 || "").trim()
  ].filter(Boolean);
}

function authorized(request, env) {
  const ips = allowedIps(env);
  const secret = String(env.VPS_API_SECRET || "");
  if (!ips.length || !secret) return false;
  if (!ips.includes(clientIp(request))) return false;

  const auth = String(request.headers.get("Authorization") || "");
  if (!auth.startsWith("Bearer ")) return false;
  return timingSafeEqual(auth.slice(7), secret);
}

async function bodyJson(request) {
  const type = String(request.headers.get("Content-Type") || "").toLowerCase();
  if (!type.includes("application/json")) throw new Error("invalid_content_type");
  return request.json();
}

export async function processarVpsApi(request, env) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith(PREFIX + "/")) return null;

  // Private server-to-server API. Never expose CORS to browsers.
  if (request.method === "OPTIONS") return new Response(null, { status: 405 });
  if (!authorized(request, env)) {
    return json({ ok: false, error: "not_found" }, 404);
  }

  try {
    if (url.pathname === PREFIX + "/health" && request.method === "GET") {
      return json({ ok: true, version: API_DIAGNOSTIC_VERSION });
    }

    if (url.pathname === PREFIX + "/route-check" && request.method === "GET") {
      return json({
        ok: true,
        version: API_DIAGNOSTIC_VERSION,
        pathname: url.pathname,
        method: request.method,
        search_route_registered: true
      });
    }

    if (url.pathname === PREFIX + "/gols/search" && request.method === "GET") {
      const q = String(url.searchParams.get("q") || "").trim();
      if (q.length < 2 || q.length > 120) return json({ ok: false, error: "invalid_query" }, 400);
      const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 50, 1), 50);
      const offset = Math.max(Number(url.searchParams.get("offset")) || 0, 0);
      const gols = await searchGoals(env.DB, q, { limit, offset });
      return json({ ok: true, gols });
    }

    if (url.pathname === PREFIX + "/gols/get" && request.method === "GET") {
      const id = String(url.searchParams.get("id") || "").trim();
      if (!id || id.length > 100) return json({ ok: false, error: "invalid_id" }, 400);
      const gol = await getGoal(env.DB, id);
      if (!gol) return json({ ok: false, error: "not_found" }, 404);
      return json({ ok: true, gol });
    }

    if (url.pathname === PREFIX + "/gols/save" && request.method === "POST") {
      const body = await bodyJson(request);
      const gol = await saveGoal(env.DB, body);
      return json({ ok: true, gol });
    }

    if (url.pathname === PREFIX + "/gols/delete" && request.method === "DELETE") {
      const id = String(url.searchParams.get("id") || "").trim();
      if (!id || id.length > 100) return json({ ok: false, error: "invalid_id" }, 400);
      await deleteGoal(env.DB, id);
      return json({ ok: true });
    }

    if (url.pathname === PREFIX + "/user/get" && request.method === "GET") {
      const uid = Number(url.searchParams.get("uid"));
      if (!Number.isSafeInteger(uid) || uid <= 0) return json({ ok: false, error: "invalid_uid" }, 400);
      const user = await env.DB.prepare(
        "SELECT id, nome, idioma, pontos, foto_url, foto_file_id, criado_em FROM usuarios WHERE id = ?"
      ).bind(uid).first();
      if (!user) return json({ ok: false, error: "not_found" }, 404);
      return json({ ok: true, user });
    }

    if (url.pathname === PREFIX + "/user/upsert" && request.method === "POST") {
      const body = await bodyJson(request);
      const uid = Number(body?.id ?? body?.uid);
      if (!Number.isSafeInteger(uid) || uid <= 0) return json({ ok: false, error: "invalid_uid" }, 400);
      const nome = String(body?.nome || "Torcedor").trim().slice(0, 160) || "Torcedor";
      const idiomaRaw = String(body?.idioma || "pt").slice(0, 2).toLowerCase();
      const idioma = ["pt", "en", "es"].includes(idiomaRaw) ? idiomaRaw : "pt";

      await env.DB.prepare(`
        INSERT INTO usuarios (id, nome, idioma, pontos, criado_em)
        VALUES (?, ?, ?, 0, ?)
        ON CONFLICT(id) DO UPDATE SET
          nome = excluded.nome,
          idioma = excluded.idioma
      `).bind(uid, nome, idioma, Date.now()).run();

      return json({ ok: true });
    }

    return json({ ok: false, error: "not_found" }, 404);
  } catch (error) {
    console.error("[VPS_API]", error);
    const message = String(error?.message || "");
    if (message === "invalid_content_type") return json({ ok: false, error: message }, 415);
    return json({ ok: false, error: "internal_error" }, 500);
  }
}
