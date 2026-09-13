import { answerCallbackQuery, editMessage } from "./telegram.js";
import { getTestConfig, setTestConfig, garantirEstruturaBolaoTeste } from "./testBolao.js";

function adminId(env) {
  return String(env?.ADMIN_TELEGRAM_ID || "7717528550");
}

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function confirmar(update, env, data) {
  const callback = update.callback_query;
  if (String(callback.from?.id || "") !== adminId(env)) {
    await answerCallbackQuery(env, callback.id, "Acesso negado.", true);
    return true;
  }

  const match = data.match(/^test_confirm_ganhou_(\d+)_(\d+)_(.+)$/);
  if (!match) {
    await answerCallbackQuery(env, callback.id, "Dados inválidos.", true);
    return true;
  }

  await garantirEstruturaBolaoTeste(env);
  const targetUserId = Number(match[1]);
  const msgIdComentario = Number(match[2]);
  const placar = String(match[3] || "Cravado").trim();
  const postId = await getTestConfig(env, "postagem_ativa_id");

  if (!postId) {
    await answerCallbackQuery(env, callback.id, "Nenhum bolão de teste ativo.", true);
    return true;
  }

  await answerCallbackQuery(env, callback.id, "Salvando vencedor de teste...");

  const palpite = await env.DB.prepare(`
    SELECT palpite, chat_id
    FROM test_palpites
    WHERE postagem_id = ? AND user_id = ? AND mensagem_id = ?
  `).bind(postId, targetUserId, msgIdComentario).first();

  const user = await env.DB.prepare("SELECT nome, pontos FROM test_usuarios WHERE id = ?").bind(targetUserId).first();
  const nome = String(user?.nome || "Torcedor");
  const confronto = (await getTestConfig(env, `confronto_${postId}`)) || (await getTestConfig(env, "confronto_atual")) || "Bolão de teste";

  const acertoExistente = await env.DB.prepare("SELECT resgatado FROM test_acertos WHERE postagem_id = ? AND user_id = ?").bind(postId, targetUserId).first();
  const chavePonto = `ganhou_ponto_${postId}_${targetUserId}`;
  const pontoMarcado = await getTestConfig(env, chavePonto);
  const pontoJaConcedido = pontoMarcado === "true" || Boolean(acertoExistente);

  if (!pontoJaConcedido) {
    await env.DB.prepare(`
      INSERT INTO test_usuarios (id, nome, pontos, criado_em)
      VALUES (?, ?, 1, ?)
      ON CONFLICT(id) DO UPDATE SET nome = excluded.nome, pontos = COALESCE(test_usuarios.pontos, 0) + 1
    `).bind(targetUserId, nome, Date.now()).run();
    await setTestConfig(env, chavePonto, "true");
  }

  const placarFinal = palpite?.palpite || placar;
  await env.DB.prepare(`
    INSERT INTO test_acertos (postagem_id, user_id, confronto, placar, resgatado, resgatado_em)
    VALUES (?, ?, ?, ?, 0, NULL)
    ON CONFLICT(postagem_id, user_id) DO UPDATE SET
      confronto = excluded.confronto,
      placar = excluded.placar,
      resgatado = CASE WHEN test_acertos.resgatado = 1 THEN 1 ELSE 0 END,
      resgatado_em = CASE WHEN test_acertos.resgatado = 1 THEN test_acertos.resgatado_em ELSE NULL END
  `).bind(postId, targetUserId, confronto, placarFinal).run();

  const atualizado = await env.DB.prepare("SELECT pontos FROM test_usuarios WHERE id = ?").bind(targetUserId).first();
  const pontos = Number(atualizado?.pontos || 0);
  const statusPonto = pontoJaConcedido
    ? "ℹ️ Ponto de teste já estava contabilizado; nenhum ponto duplicado foi adicionado."
    : "➕ +1 ponto adicionado ao ranking de teste.";

  await editMessage(
    env,
    callback.message?.chat?.id,
    callback.message?.message_id,
    `🧪 <b>PALPITE VENCEDOR DE TESTE SALVO PARA RESGATE</b>\n\n` +
      `👤 <b>Torcedor:</b> ${esc(nome)}\n` +
      `🏟 <b>Partida:</b> ${esc(confronto)}\n` +
      `📌 <b>Palpite:</b> <code>${esc(placarFinal)}</code>\n` +
      `${statusPonto}\n` +
      `📊 <b>Total no ranking de teste:</b> ${pontos}\n\n` +
      `🎁 <b>Resgate:</b> <code>https://t.me/FlamengoGolsBot?start=teste_resgatar_${postId}</code>\n` +
      `⚠️ Nenhum ponto do ranking real foi alterado.`
  );

  return true;
}

async function cancelar(update, env) {
  const callback = update.callback_query;
  if (String(callback.from?.id || "") !== adminId(env)) {
    await answerCallbackQuery(env, callback.id, "Acesso negado.", true);
    return true;
  }
  await answerCallbackQuery(env, callback.id, "Teste cancelado.");
  await editMessage(env, callback.message?.chat?.id, callback.message?.message_id, "🧪❌ <b>Registro de vencedor de teste cancelado.</b>");
  return true;
}

export async function processarCallbackGanhouTeste(update, env) {
  const data = String(update?.callback_query?.data || "");
  try {
    if (data.startsWith("test_confirm_ganhou_")) return await confirmar(update, env, data);
    if (data === "test_cancel_ganhou") return await cancelar(update, env);
  } catch (error) {
    console.error("processarCallbackGanhouTeste", error);
    try {
      await answerCallbackQuery(env, update.callback_query.id, "Erro no ambiente de teste.", true);
    } catch {}
    return true;
  }
  return false;
}
