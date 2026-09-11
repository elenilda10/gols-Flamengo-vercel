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

function normalizarPlacar(valor) {
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
    return { palpite: direto.palpite || "", recuperado: false, origemPostagemId: String(postagemId) };
  }

  const bolao = await env.DB.prepare(
    "SELECT criado_em FROM boloes WHERE postagem_id = ?"
  ).bind(postagemId).first();

  const inicio = Number(bolao?.criado_em || 0);
  const fim = Number(encerradoEm || 0);
  const placarOficialNormalizado = normalizarPlacar(resultadoOficial);

  if (!inicio || !fim || !placarOficialNormalizado) {
    return { palpite: "", recuperado: false, origemPostagemId: null };
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
    return { palpite: "", recuperado: false, origemPostagemId: null };
  }

  return {
    palpite: candidatos[0].palpite || "",
    recuperado: true,
    origemPostagemId: String(candidatos[0].postagem_id || "")
  };
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
  const idiomaRaw = String(message.from?.language_code || "pt").slice(0, 2).toLowerCase();
  const idioma = ["pt", "en", "es"].includes(idiomaRaw) ? idiomaRaw : "pt";

  await env.DB.prepare(`
    INSERT INTO usuarios (id, nome, idioma, pontos, criado_em)
    VALUES (?, ?, ?, 0, ?)
    ON CONFLICT(id) DO UPDATE SET nome = excluded.nome
  `).bind(userId, nome, idioma, Date.now()).run();

  const mention = `<a href="tg://user?id=${userId}">${escHTML(nome)}</a>`;
  const confronto = (await getConfig(env.DB, `confronto_${postagemId}`)) ||
    (await getConfig(env.DB, "confronto_atual")) ||
    "Flamengo";
  const resultadoOficial = (await getConfig(env.DB, `resultado_oficial_${postagemId}`)) || "Resultado Oficial";
  const encerradoEm = Number(await getConfig(env.DB, `bolao_encerrado_em_${postagemId}`)) || 0;
  const aindaEmRevisao = encerradoEm > 0 && Date.now() - encerradoEm < 60 * 60 * 1000;

  const palpiteInfo = await localizarPalpiteDoBolao(env, postagemId, userId, resultadoOficial, encerradoEm);
  const palpite = palpiteInfo.palpite || "";
  const textoPalpite = palpite ? `\n📌 Seu palpite: <b>${escHTML(palpite)}</b>` : "";

  const acertoExistente = await env.DB.prepare(
    "SELECT resgatado FROM acertos WHERE postagem_id = ? AND user_id = ?"
  ).bind(postagemId, userId).first();

  if (Number(acertoExistente?.resgatado) === 1) {
    await setConfig(env.DB, `resgate_concluido_${postagemId}_${userId}`, "true");
    await sendMessage(
      env,
      chatId,
      `✅ ${mention}, este ponto já foi contabilizado.\n\n🏟 <b>Bolão:</b> ${escHTML(confronto)}\n⚽ <b>Resultado:</b> ${escHTML(resultadoOficial)}${textoPalpite}`
    );
    return true;
  }

  const winnersKey = `vencedores_ids_${postagemId}`;
  const vencedoresIds = parseVencedores(await getConfig(env.DB, winnersKey));
  const ganhouPorLista = vencedoresIds.includes(String(userId));
  const placarPalpite = normalizarPlacar(palpite);
  const placarOficial = normalizarPlacar(resultadoOficial);
  const ganhouPorPlacar = Boolean(placarPalpite && placarOficial && placarPalpite === placarOficial);
  const ganhou = ganhouPorLista || ganhouPorPlacar;

  if (ganhouPorPlacar && !ganhouPorLista) {
    vencedoresIds.push(String(userId));
    await setConfig(env.DB, winnersKey, JSON.stringify([...new Set(vencedoresIds)]));
  }

  if (!ganhou) {
    await setConfig(env.DB, `resgate_verificado_${postagemId}_${userId}`, "true");

    if (!palpite) {
      await sendMessage(
        env,
        chatId,
        `⚠️ ${mention}, não consegui localizar seu palpite vinculado a este bolão.\n\n🏟 <b>Bolão:</b> ${escHTML(confronto)}\n⚽ <b>Resultado:</b> ${escHTML(resultadoOficial)}\n\nSeu ponto <b>não foi descartado</b>. O sistema não vai marcar você como perdedor sem encontrar o palpite. Entre em contato com o suporte para conferência do registro.`
      );
      return true;
    }

    const revisao = aindaEmRevisao ? "\n\n🕒 O resultado ainda está no período de revisão de 1 hora." : "";
    await sendMessage(
      env,
      chatId,
      `😔 ${mention}, seu palpite não corresponde ao resultado oficial.\n\n🏟 <b>Bolão:</b> ${escHTML(confronto)}\n⚽ <b>Resultado:</b> ${escHTML(resultadoOficial)}${textoPalpite}\n\n❌ Status: <b>Palpite diferente do resultado.</b>${revisao}`
    );
    return true;
  }

  const agora = Date.now();
  const placarFinal = palpite || resultadoOficial;

  const claim = await env.DB.prepare(`
    INSERT INTO acertos (postagem_id, user_id, confronto, placar, resgatado, resgatado_em)
    VALUES (?, ?, ?, ?, 1, ?)
    ON CONFLICT(postagem_id, user_id) DO UPDATE SET
      confronto = excluded.confronto,
      placar = excluded.placar,
      resgatado = 1,
      resgatado_em = excluded.resgatado_em
    WHERE COALESCE(acertos.resgatado, 0) = 0
  `).bind(postagemId, userId, confronto, placarFinal, agora).run();

  const alterou = Number(claim?.meta?.changes || 0) > 0;

  if (!alterou) {
    await setConfig(env.DB, `resgate_concluido_${postagemId}_${userId}`, "true");
    await sendMessage(
      env,
      chatId,
      `✅ ${mention}, este ponto já havia sido processado anteriormente.\n\n🏟 <b>Bolão:</b> ${escHTML(confronto)}\n⚽ <b>Resultado:</b> ${escHTML(resultadoOficial)}${textoPalpite}`
    );
    return true;
  }

  await env.DB.prepare("UPDATE usuarios SET pontos = pontos + 1 WHERE id = ?").bind(userId).run();
  await setConfig(env.DB, `resgate_concluido_${postagemId}_${userId}`, "true");

  const userAtualizado = await env.DB.prepare("SELECT pontos FROM usuarios WHERE id = ?").bind(userId).first();
  const total = Number(userAtualizado?.pontos || 0);
  const jaVerificou = await getConfig(env.DB, `resgate_verificado_${postagemId}_${userId}`);

  const observacoes = [];
  if (jaVerificou === "true") observacoes.push("🛠 Seu acerto foi reconhecido após nova conferência.");
  if (palpiteInfo.recuperado) observacoes.push("🔧 O vínculo do seu palpite foi recuperado automaticamente.");
  if (ganhouPorPlacar && !ganhouPorLista) observacoes.push("✅ O placar salvo no D1 confirmou seu acerto.");
  const textoExtra = observacoes.length ? `\n${observacoes.join("\n")}` : "";

  await sendMessage(
    env,
    chatId,
    `🎯 ${mention}, seu acerto foi reconhecido! ❤️🖤\n\n🏆 <b>Bolão:</b> ${escHTML(confronto)}\n⚽ <b>Resultado:</b> ${escHTML(resultadoOficial)}${textoPalpite}\n\n✅ Status: <b>Você ganhou!</b>${textoExtra}\n\n➕ Ponto adicionado uma única vez.\n📊 Total de acertos: <b>${total}</b>`
  );

  return true;
}
