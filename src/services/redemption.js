import { sendMessage } from "./telegram.js";

async function getConfig(db, chave) {
  const row = await db.prepare("SELECT valor FROM config WHERE chave = ?").bind(chave).first();
  return row ? row.valor : null;
}

async function setConfig(db, chave, valor) {
  await db.prepare("INSERT OR REPLACE INTO config (chave, valor) VALUES (?, ?)")
    .bind(chave, String(valor))
    .run();
}

function escHTML(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function nomeUsuario(from) {
  const nome = `${from?.first_name || ""} ${from?.last_name || ""}`
    .replace(/[\u0000-\u001F\u007F-\u009F\uFFFD]/g, "")
    .trim();
  return nome || "Torcedor";
}

function parseVencedores(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export function normalizarPlacar(valor) {
  const texto = String(valor || "").trim().toLowerCase();
  const match = texto.match(/(\d+)\s*(?:x|×|-|a|:)\s*(\d+)/i);
  if (!match) return "";
  return `${Number(match[1])}x${Number(match[2])}`;
}

async function localizarPalpiteDoBolao(env, postagemId, userId, resultadoOficial, encerradoEm) {
  const direto = await env.DB.prepare(
    "SELECT postagem_id, palpite, criado_em FROM palpites WHERE postagem_id = ? AND user_id = ?"
  ).bind(postagemId, userId).first();

  if (direto) {
    return { palpite: direto.palpite || "", recuperado: false };
  }

  const bolao = await env.DB.prepare(
    "SELECT criado_em FROM boloes WHERE postagem_id = ?"
  ).bind(postagemId).first();

  const inicio = Number(bolao?.criado_em || 0);
  const fim = Number(encerradoEm || 0);
  const placarOficialNormalizado = normalizarPlacar(resultadoOficial);

  if (!inicio || !fim || !placarOficialNormalizado) {
    return { palpite: "", recuperado: false };
  }

  const margem = 5 * 60 * 1000;
  const { results } = await env.DB.prepare(`
    SELECT postagem_id, palpite, criado_em
    FROM palpites
    WHERE user_id = ?
      AND CAST(criado_em AS INTEGER) >= ?
      AND CAST(criado_em AS INTEGER) <= ?
    ORDER BY CAST(criado_em AS INTEGER) DESC
    LIMIT 20
  `).bind(userId, inicio - margem, fim + margem).all();

  const candidatos = (results || []).filter(
    (p) => normalizarPlacar(p.palpite) === placarOficialNormalizado
  );

  if (candidatos.length !== 1) {
    return { palpite: "", recuperado: false };
  }

  return { palpite: candidatos[0].palpite || "", recuperado: true };
}

async function salvarHistoricoResgate(env, { postagemId, userId, confronto, palpite, resultadoOficial }) {
  const agora = Date.now();
  const placar = palpite || normalizarPlacar(resultadoOficial) || resultadoOficial;

  await env.DB.prepare(`
    INSERT INTO acertos (postagem_id, user_id, confronto, placar, resgatado, resgatado_em)
    VALUES (?, ?, ?, ?, 1, ?)
    ON CONFLICT(postagem_id, user_id) DO UPDATE SET
      confronto = excluded.confronto,
      placar = CASE
        WHEN excluded.placar IS NOT NULL AND excluded.placar != '' THEN excluded.placar
        ELSE acertos.placar
      END,
      resgatado = 1,
      resgatado_em = COALESCE(acertos.resgatado_em, excluded.resgatado_em)
  `).bind(postagemId, userId, confronto, placar, agora).run();

  await setConfig(env.DB, `resgate_concluido_${postagemId}_${userId}`, "true");
  await setConfig(env.DB, `resgate_verificado_${postagemId}_${userId}`, "true");
}

export function extrairPostagemIdResgate(texto) {
  const match = String(texto || "").trim().match(/^\/start(?:@[A-Za-z0-9_]+)?\s+resgatar_([A-Za-z0-9_-]{1,100})$/i);
  return match?.[1] || null;
}

export async function processarResgatePontos(update, env) {
  const message = update?.message;
  if (!message) return false;

  const postagemId = extrairPostagemIdResgate(message.text);
  if (!postagemId) return false;

  const userId = Number(message.from?.id);
  const chatId = message.chat?.id;
  if (!userId || !chatId) return true;

  const nome = nomeUsuario(message.from);
  const mention = `<a href="tg://user?id=${userId}">${escHTML(nome)}</a>`;

  const user = await env.DB.prepare("SELECT pontos FROM usuarios WHERE id = ?").bind(userId).first();
  const pontos = Number(user?.pontos || 0);

  const confronto = (await getConfig(env.DB, `confronto_${postagemId}`)) ||
    (await getConfig(env.DB, "confronto_atual")) ||
    "Flamengo";
  const resultadoOficial = (await getConfig(env.DB, `resultado_oficial_${postagemId}`)) || "Resultado Oficial";
  const encerradoEm = Number(await getConfig(env.DB, `bolao_encerrado_em_${postagemId}`)) || 0;

  const palpiteInfo = await localizarPalpiteDoBolao(env, postagemId, userId, resultadoOficial, encerradoEm);
  const palpite = palpiteInfo.palpite || "";
  const textoPalpite = palpite ? `\n📌 <b>Seu palpite:</b> ${escHTML(palpite)}` : "";

  const acerto = await env.DB.prepare(
    "SELECT confronto, placar, resgatado FROM acertos WHERE postagem_id = ? AND user_id = ?"
  ).bind(postagemId, userId).first();

  const vencedoresIds = parseVencedores(await getConfig(env.DB, `vencedores_ids_${postagemId}`));
  const vencedorRegistrado = Boolean(acerto) || vencedoresIds.includes(String(userId));

  if (!vencedorRegistrado) {
    await sendMessage(
      env,
      chatId,
      `❌ ${mention}, este resgate não foi encontrado como vencedor deste bolão.\n\n` +
        `🏟 <b>Partida:</b> ${escHTML(confronto)}\n` +
        `⚽ <b>Resultado oficial:</b> ${escHTML(resultadoOficial)}${textoPalpite}\n\n` +
        `ℹ️ <b>O resgate nunca adiciona pontos.</b> O ponto é concedido somente pelo comando administrativo <code>/ganhou</code>.\n` +
        `📊 <b>Sua pontuação atual:</b> ${pontos} ponto(s).`
    );
    return true;
  }

  const palpiteHistorico = palpite || acerto?.placar || normalizarPlacar(resultadoOficial) || resultadoOficial;

  await salvarHistoricoResgate(env, {
    postagemId,
    userId,
    confronto,
    palpite: palpiteHistorico,
    resultadoOficial
  });

  const jaResgatado = Number(acerto?.resgatado) === 1;
  const recuperado = palpiteInfo.recuperado
    ? "\n🔧 O vínculo do palpite foi recuperado automaticamente para o histórico."
    : "";

  await sendMessage(
    env,
    chatId,
    `${jaResgatado ? "✅" : "🏆"} ${mention}, <b>${jaResgatado ? "este resgate já estava confirmado" : "resgate confirmado"}</b>.\n\n` +
      `🏟 <b>Partida acertada:</b> ${escHTML(confronto)}\n` +
      `📌 <b>Seu palpite:</b> ${escHTML(palpiteHistorico)}\n` +
      `⚽ <b>Resultado oficial:</b> ${escHTML(resultadoOficial)}\n` +
      `✅ <b>Status:</b> acerto salvo no histórico e resgate confirmado.${recuperado}\n\n` +
      `📊 <b>Sua pontuação permanece:</b> ${pontos} ponto(s).\n` +
      `ℹ️ O ponto já foi concedido anteriormente pelo <code>/ganhou</code>. Este resgate é apenas a confirmação e <b>não adiciona pontos</b>.`
  );

  return true;
}
