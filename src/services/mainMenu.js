import { answerCallbackQuery, editMessage, sendMessage } from "./telegram.js";

const RANKING_URL = "https://lucky-bar-5077.futvert.workers.dev/ranking";

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function nomeUsuario(from) {
  return `${from?.first_name || ""} ${from?.last_name || ""}`
    .replace(/[\u0000-\u001F\u007F-\u009F\uFFFD]/g, "")
    .trim() || "Torcedor";
}

function idiomaTelegram(from) {
  const code = String(from?.language_code || "pt").toLowerCase();
  if (code.startsWith("en")) return "en";
  if (code.startsWith("es")) return "es";
  return "pt";
}

async function garantirUsuario(env, from) {
  const id = Number(from?.id);
  if (!id) return { idioma: "pt", nome: "Torcedor" };

  const nome = nomeUsuario(from);
  const existente = await env.DB.prepare("SELECT idioma, nome FROM usuarios WHERE id = ?").bind(id).first();
  const idioma = ["pt", "en", "es"].includes(String(existente?.idioma || "").toLowerCase())
    ? String(existente.idioma).toLowerCase()
    : idiomaTelegram(from);

  if (!existente) {
    await env.DB.prepare(`
      INSERT INTO usuarios (id, nome, idioma, pontos, criado_em)
      VALUES (?, ?, ?, 0, ?)
    `).bind(id, nome, idioma, Date.now()).run();
  } else if (existente.nome !== nome && nome !== "Torcedor") {
    await env.DB.prepare("UPDATE usuarios SET nome = ? WHERE id = ?").bind(nome, id).run();
  }

  return { idioma, nome };
}

async function totalUsuarios(env) {
  const row = await env.DB.prepare("SELECT COUNT(*) AS total FROM usuarios").first();
  return Number(row?.total || 1);
}

function conteudoMenu(lang, nome, total) {
  const textos = {
    pt: `👋 Olá ${esc(nome)}, seja muito bem-vindo(a) ao @FlamengoGolsBot! 🔴⚫\n\nAqui você encontra todos os gols dos campeonatos que o Mengão disputa.\n\n✍️ Como usar:\nDigite em qualquer chat:\n@FlamengoGolsBot Flamengo\n\n☝️ Mais comandos: /ajuda\n\n▶️ Usuários ativos: ${total}`,
    en: `👋 Hello ${esc(nome)}, welcome to @FlamengoGolsBot! 🔴⚫\n\nHere you will find goals from all the championships Flamengo plays in.\n\n✍️ How to use:\nType in any chat:\n@FlamengoGolsBot Flamengo\n\n☝️ More commands: /help\n\n▶️ Active users: ${total}`,
    es: `👋 ¡Hola ${esc(nome)}, bienvenido al @FlamengoGolsBot! 🔴⚫\n\nAquí encontrarás todos los goles de los campeonatos que disputa el Flamengo.\n\n✍️ Cómo usar:\nEscribe en cualquier chat:\n@FlamengoGolsBot Flamengo\n\n☝️ Más comandos: /ayuda\n\n▶️ Usuarios activos: ${total}`
  };

  const botoes = {
    pt: { buscar: "Buscar Flamengo", livre: "Busca Livre", ranking: "🏆 Ranking", canal: "Canal Oficial", suporte: "Suporte 🛠", idioma: "Mudar Idioma" },
    en: { buscar: "Search Flamengo", livre: "Free Search", ranking: "🏆 Ranking", canal: "Official Channel", suporte: "Support 🛠", idioma: "Change Language" },
    es: { buscar: "Buscar Flamengo", livre: "Búsqueda Libre", ranking: "🏆 Ranking", canal: "Canal Oficial", suporte: "Soporte 🛠", idioma: "Cambiar Idioma" }
  };

  const btn = botoes[lang] || botoes.pt;
  return {
    texto: textos[lang] || textos.pt,
    teclado: [
      [{ text: btn.buscar, switch_inline_query_current_chat: "Flamengo" }, { text: btn.livre, switch_inline_query_current_chat: "" }],
      [{ text: btn.ranking, url: RANKING_URL }],
      [{ text: btn.canal, url: "https://t.me/Flamengo77" }],
      [{ text: btn.suporte, callback_data: "suporte_bot" }, { text: btn.idioma, callback_data: "change_lang" }]
    ]
  };
}

async function mostrarMenuMensagem(update, env) {
  const message = update?.message;
  const texto = String(message?.text || "").trim();
  if (!/^\/start(?:@[A-Za-z0-9_]+)?\s*$/i.test(texto)) return false;

  const user = await garantirUsuario(env, message.from);
  const total = await totalUsuarios(env);
  const menu = conteudoMenu(user.idioma, user.nome, total);
  await sendMessage(env, message.chat.id, menu.texto, menu.teclado);
  return true;
}

async function mostrarMenuCallback(update, env) {
  const callback = update?.callback_query;
  if (!callback?.message) return false;

  let data = String(callback.data || "");
  if (data !== "menu_principal" && !data.startsWith("set_lang_")) return false;

  let user = await garantirUsuario(env, callback.from);
  if (data.startsWith("set_lang_")) {
    const novoIdioma = data.replace("set_lang_", "");
    if (["pt", "en", "es"].includes(novoIdioma)) {
      await env.DB.prepare("UPDATE usuarios SET idioma = ? WHERE id = ?").bind(novoIdioma, Number(callback.from.id)).run();
      user.idioma = novoIdioma;
      const avisos = { pt: "Idioma alterado! 🇧🇷", en: "Language changed! 🇺🇸", es: "¡Idioma cambiado! 🇪🇸" };
      await answerCallbackQuery(env, callback.id, avisos[novoIdioma]);
    }
  } else {
    await answerCallbackQuery(env, callback.id);
  }

  const total = await totalUsuarios(env);
  const menu = conteudoMenu(user.idioma, user.nome, total);
  await editMessage(env, callback.message.chat.id, callback.message.message_id, menu.texto, menu.teclado);
  return true;
}

export async function processarMenuPrincipal(update, env) {
  if (update?.message) return mostrarMenuMensagem(update, env);
  if (update?.callback_query) return mostrarMenuCallback(update, env);
  return false;
}
