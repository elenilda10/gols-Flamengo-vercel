import { answerInlineQuery } from "../services/telegram.js";
import { goalToInlineResult, normalizeGoalSearch, searchGoals } from "../services/goals.js";

function textos(lang) {
  const base = {
    pt: {
      search_title: "🔍 Buscar Gols",
      search_desc: "Digite jogador, time ou campeonato",
      search_msg: "🔍 <b>BUSCA DE GOLS ⚽</b>\n\nDigite palavras-chave como:\n• Pedro\n• Flamengo\n• Libertadores\n• Brasileirão\n\n⚠️ <b>Para ver todos os gols:</b>\n👉 Digite: <code>Flamengo</code>",
      list_title: "📋 Lista completa de gols",
      list_desc: "Clique para ver todos os gols do Flamengo",
      list_msg: "📋 <b>LISTA COMPLETA ⚽</b>\n\nPara ver todos os gols:\n👉 Digite: <code>Flamengo</code>",
      btn_search: "🔎 Buscar",
      btn_all: "📋 Ver todos os gols"
    },
    en: {
      search_title: "🔍 Search Goals",
      search_desc: "Type player, team or competition",
      search_msg: "🔍 <b>GOALS SEARCH ⚽</b>\n\nType keywords like:\n• Pedro\n• Flamengo\n• Libertadores\n\n⚠️ <b>To see all goals:</b>\n👉 Type: <code>Flamengo</code>",
      list_title: "📋 Full goals list",
      list_desc: "Click to see all Flamengo goals",
      list_msg: "📋 <b>FULL LIST ⚽</b>\n\nTo see all goals:\n👉 Type: <code>Flamengo</code>",
      btn_search: "🔎 Search",
      btn_all: "📋 View all goals"
    },
    es: {
      search_title: "🔍 Buscar Goles",
      search_desc: "Escribe jugador, equipo o competición",
      search_msg: "🔍 <b>BÚSQUEDA DE GOLES ⚽</b>\n\nEscribe palabras clave como:\n• Pedro\n• Flamengo\n• Libertadores\n\n⚠️ <b>Para ver todos los goles:</b>\n👉 Escribe: <code>Flamengo</code>",
      list_title: "📋 Lista completa de goles",
      list_desc: "Haz clic para ver todos los goles",
      list_msg: "📋 <b>LISTA COMPLETA ⚽</b>\n\nPara ver todos los goles:\n👉 Escribe: <code>Flamengo</code>",
      btn_search: "🔎 Buscar",
      btn_all: "📋 Ver todos los goles"
    }
  };

  return base[lang] || base.pt;
}

function ajudaInline(t) {
  return [
    {
      type: "article",
      id: "search_help",
      title: t.search_title,
      description: t.search_desc,
      input_message_content: { message_text: t.search_msg, parse_mode: "HTML" },
      reply_markup: {
        inline_keyboard: [
          [{ text: t.btn_search, switch_inline_query_current_chat: "" }],
          [{ text: t.btn_all, switch_inline_query_current_chat: "Flamengo" }]
        ]
      }
    },
    {
      type: "article",
      id: "list_all",
      title: t.list_title,
      description: t.list_desc,
      input_message_content: { message_text: t.list_msg, parse_mode: "HTML" },
      reply_markup: {
        inline_keyboard: [
          [{ text: t.btn_all, switch_inline_query_current_chat: "Flamengo" }],
          [{ text: t.btn_search, switch_inline_query_current_chat: "" }]
        ]
      }
    }
  ];
}

export async function handleInlineQuery(update, env) {
  const inlineQuery = update?.inline_query;
  if (!inlineQuery) return new Response("OK", { status: 200 });

  try {
    const uid = Number(inlineQuery.from?.id);
    const userDb = uid
      ? await env.DB.prepare("SELECT idioma FROM usuarios WHERE id = ?").bind(uid).first()
      : null;

    let lang = String(userDb?.idioma || inlineQuery.from?.language_code || "pt").slice(0, 2).toLowerCase();
    if (!["pt", "en", "es"].includes(lang)) lang = "pt";

    const buscaNorm = normalizeGoalSearch(inlineQuery.query || "");
    const offset = Math.max(0, Number.parseInt(inlineQuery.offset || "0", 10) || 0);
    const t = textos(lang);

    if (buscaNorm.length < 2) {
      await answerInlineQuery(env, inlineQuery.id, ajudaInline(t));
      return new Response("OK", { status: 200 });
    }

    const limite = 50;
    const gols = await searchGoals(env.DB, buscaNorm, { limit: limite, offset });
    const resultados = gols.map((gol) => goalToInlineResult(gol, offset));

    const nextOffset = resultados.length === limite ? String(offset + limite) : "";
    await answerInlineQuery(env, inlineQuery.id, resultados, nextOffset);
    return new Response("OK", { status: 200 });
  } catch (error) {
    console.error("inlineQueryHandler", error);
    return new Response("OK", { status: 200 });
  }
}
