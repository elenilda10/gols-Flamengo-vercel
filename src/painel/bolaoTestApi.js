import { garantirEstruturaBolaoTeste, getTestConfig, setTestConfig, deleteTestConfig } from "../services/testBolao.js";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" }
  });
}

const PATHS = new Set([
  "/api/teste/bolao-status",
  "/api/teste/bolao-toggle",
  "/api/teste/bolao-reset"
]);

export async function processarBolaoTestApi(request, env) {
  const url = new URL(request.url);
  if (!PATHS.has(url.pathname)) return null;
  await garantirEstruturaBolaoTeste(env);

  if (url.pathname === "/api/teste/bolao-status" && request.method === "GET") {
    const postId = await getTestConfig(env, "postagem_ativa_id");
    const confronto = await getTestConfig(env, "confronto_atual");
    const aberto = (await getTestConfig(env, "bolao_aberto")) === "true";
    const counts = postId
      ? await env.DB.prepare(`SELECT
          (SELECT COUNT(*) FROM test_palpites WHERE postagem_id = ?) AS palpites,
          (SELECT COUNT(*) FROM test_acertos WHERE postagem_id = ?) AS vencedores,
          (SELECT COUNT(*) FROM test_acertos WHERE postagem_id = ? AND resgatado = 1) AS resgates
        `).bind(postId, postId, postId).first()
      : { palpites: 0, vencedores: 0, resgates: 0 };

    return json({ ok: true, aberto, postId, confronto, ...counts });
  }

  if (url.pathname === "/api/teste/bolao-toggle" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    await setTestConfig(env, "bolao_aberto", body.aberto ? "true" : "false");
    return json({ ok: true });
  }

  if (url.pathname === "/api/teste/bolao-reset" && request.method === "POST") {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM test_palpites"),
      env.DB.prepare("DELETE FROM test_acertos"),
      env.DB.prepare("DELETE FROM test_boloes"),
      env.DB.prepare("DELETE FROM test_usuarios"),
      env.DB.prepare("DELETE FROM test_config")
    ]);
    await deleteTestConfig(env, "postagem_ativa_id");
    return json({ ok: true });
  }

  return json({ ok: false, error: "method_not_allowed" }, 405);
}
