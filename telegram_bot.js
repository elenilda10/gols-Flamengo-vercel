export default {
  async fetch(request, env) {
    return await processarMensagemTelegram(request, env, env.TELEGRAM_TOKEN);
  },

  // ==========================================================
  // ⏰ CRON TRIGGER: Executa tarefas agendadas (Postar e Deletar Anúncios)
  // ==========================================================
  async scheduled(event, env, ctx) {
    ctx.waitUntil(processarAgendamentosAnuncios(env));
  }
};

// ==========================================================
// 📥 FLUXO PRINCIPAL DO TELEGRAM
// ==========================================================
export async function processarMensagemTelegram(request, env, botTokenPassado) {
    const botToken = botTokenPassado || env.TELEGRAM_TOKEN; 

    try {
        const update = await request.json();

        // ==========================================================
        // ⚡ MODO INLINE QUERY (Permanecendo 100% Ativo)
        // ==========================================================
        if (update.inline_query) {
            const inlineQuery = update.inline_query;
            const busca = inlineQuery.query || "";
            const queryId = inlineQuery.id;
            const offset = parseInt(inlineQuery.offset || "0") || 0;
            const uidTelegram = String(inlineQuery.from.id);
            
            let idiomaSalvo = await env.GOLS_FLAMENGO_KV.get(`lang_${uidTelegram}`);
            let lang = "pt";

            if (idiomaSalvo && ["pt", "en", "es"].includes(idiomaSalvo.toLowerCase().trim())) {
                lang = idiomaSalvo.toLowerCase().trim();
            } else {
                let userLangCode = String(inlineQuery.from.language_code || "pt").toLowerCase();
                if (userLangCode.startsWith("en")) lang = "en";
                else if (userLangCode.startsWith("es")) lang = "es";
            }

            const texts = {
                pt: { search_title: "🔍 Buscar Gols", search_desc: "Digite jogador, time ou campeonato", search_msg: "🔍 <b>BUSCA DE GOLS ⚽</b>\n\nDigite palavras-chave como:\n• Pedro\n• Flamengo\n• Libertadores\n• Brasileirão\n\n⚠️ <b>Para ver todos os gols:</b>\n👉 Digite: <code>Flamengo</code>", list_title: "📋 Lista completa de gols", list_desc: "Clique para ver todos os gols do Flamengo", list_msg: "📋 <b>LISTA COMPLETA ⚽</b>\n\nPara ver todos os gols:\n👉 Digite: <code>Flamengo</code>", btn_search: "🔎 Buscar", btn_all: "📋 Ver todos os gols", btn_all_query: "Flamengo" },
                en: { search_title: "🔍 Search Goals", search_desc: "Type player, team or competition", search_msg: "🔍 <b>GOALS SEARCH ⚽</b>\n\nType keywords like:\n• Pedro\n• Flamengo\n• Libertadores\n\n⚠️ <b>To see all goals:</b>\n👉 Type: <code>Flamengo</code>", list_title: "📋 Full goals list", list_desc: "Click to see all Flamengo goals", list_msg: "📋 <b>FULL LIST ⚽</b>\n\nTo see all goals:\n👉 Type: <code>Flamengo</code>", btn_search: "🔎 Search", btn_all: "📋 View all goals", btn_all_query: "Flamengo" },
                es: { search_title: "🔍 Buscar Goles", search_desc: "Escribe jugador, equipo o competición", search_msg: "🔍 <b>BÚSQUEDA DE GOLES ⚽</b>\n\nEscribe palabras clave como:\n• Pedro\n• Flamengo\n• Libertadores\n\n⚠️ <b>Para ver todos los goles:</b>\n👉 Escribe: <code>Flamengo</code>", list_title: "📋 Lista completa de goles", list_desc: "Haz clic para ver todos los goles", list_msg: "📋 <b>LISTA COMPLETA ⚽</b>\n\nPara ver todos los goles:\n👉 Escribe: <code>Flamengo</code>", btn_search: "🔎 Buscar", btn_all: "📋 Ver todos os goles", btn_all_query: "Flamengo" }
            };
            const t = (k) => texts[lang][k];

            const safeNormalize = (text) => {
                if (!text) return "";
                try { text = text.toLowerCase().trim().normalize("NFD").replace(/[\u0300-\u036f]/g, ""); } catch (e) {}
                return text.replace(/@flamengogolsbot/gi, "").replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
            };

            const buscaNorm = safeNormalize(busca);

            const responderInline = async (resultados, proxOffset = "") => {
                await fetch(`https://api.telegram.org/bot${botToken}/answerInlineQuery`, {
                    method: "POST", headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ inline_query_id: queryId, results: resultados, cache_time: 0, is_personal: true, next_offset: proxOffset })
                });
            };

            if (buscaNorm.length < 2) {
                let articles = [
                    { type: "article", id: "search_help", title: t("search_title"), description: t("search_desc"), input_message_content: { message_text: t("search_msg"), parse_mode: "HTML" }, reply_markup: { inline_keyboard: [[{ text: t("btn_search"), switch_inline_query_current_chat: "" }], [{ text: t("btn_all"), switch_inline_query_current_chat: t("btn_all_query") }]] } },
                    { type: "article", id: "list_all", title: t("list_title"), description: t("list_desc"), input_message_content: { message_text: t("list_msg"), parse_mode: "HTML" }, reply_markup: { inline_keyboard: [[{ text: t("btn_all"), switch_inline_query_current_chat: t("btn_all_query") }], [{ text: t("btn_search"), switch_inline_query_current_chat: "" }]] } }
                ];
                await responderInline(articles);
                return new Response("OK", { status: 200 });
            }

            let indexRaw = await env.GOLS_FLAMENGO_KV.get("gols_index");
            let index = indexRaw ? JSON.parse(indexRaw) : [];
            let aliasesRaw = await env.GOLS_FLAMENGO_KV.get("SEARCH_ALIASES");
            let searchAliases = aliasesRaw ? JSON.parse(aliasesRaw) : { competitions: {} };

            let termosOriginais = buscaNorm.split(" ").filter(Boolean);
            let resultados = [];
            const MAX_RESULTS = 50;
            const BATCH_SIZE = 20;

            let totalNoIndex = index.length;
            let i = (totalNoIndex - 1) - offset;
            let itensPercorridos = 0;

            while (i >= 0 && resultados.length < MAX_RESULTS) {
                let loteIds = [];
                for (let j = 0; j < BATCH_SIZE && (i - j) >= 0; j++) loteIds.push(index[i - j]);

                const loteDadosRaw = await Promise.all(loteIds.map(id => env.GOLS_FLAMENGO_KV.get(`gol_${id}`)));

                for (let j = 0; j < loteDadosRaw.length; j++) {
                    if (resultados.length >= MAX_RESULTS) break;
                    itensPercorridos++;
                    const golRaw = loteDadosRaw[j];
                    if (!golRaw) continue;
                    const gol = JSON.parse(golRaw);
                    if (!gol?.file_id) continue;

                    let baseTarget = safeNormalize(`${gol.jogo || ""} ${gol.autor || ""} ${gol.assistencia || ""} ${gol.campeonato || ""} ${gol.fase || gol.rodada || ""}`);
                    let campAlias = searchAliases.competitions[safeNormalize(gol.campeonato)] || {};
                    let extras = [];

                    if (campAlias.label) extras = [campAlias.label.pt, campAlias.label.en, campAlias.label.es].map(safeNormalize);
                    if (campAlias.search) extras = extras.concat(campAlias.search.map(safeNormalize));

                    let textoAlvo = baseTarget + " " + extras.join(" ");
                    if (!termosOriginais.every(term => textoAlvo.includes(term))) continue;

                    let campLabel = campAlias.label?.[lang] || gol.campeonato || "-";

                    resultados.push({
                        type: "video",
                        id: `vid_${loteIds[j]}_${offset}`,
                        video_file_id: gol.file_id,
                        title: gol.jogo || "Gol",
                        description: `⚽️ ${gol.autor || "-"} | 🏆 ${campLabel}`,
                        caption: `<b>${gol.jogo || ""}</b>\n\n⚽️ ${gol.autor || "-"}\n🅰 ${gol.assistencia || "-"}\n\n🏆 ${campLabel} - ${gol.fase || gol.rodada || "-"}\n\n🤖 @FlamengoGolsBot`,
                        parse_mode: "HTML"
                    });
                }
                if (resultados.length >= MAX_RESULTS) break;
                i -= BATCH_SIZE;
            }

            let proximoOffset = (resultados.length === MAX_RESULTS && (offset + itensPercorridos < totalNoIndex)) ? String(offset + itensPercorridos) : "";
            await responderInline(resultados, proximoOffset);
            return new Response("OK", { status: 200 });
        }

        // ==========================================================
        // 🔘 MODO MENSAGEM OU CALLBACK
        // ==========================================================
        let mensagem, texto, chatId, userId, isCallback = false, callbackId;

        if (update.callback_query) {
            isCallback = true;
            callbackId = update.callback_query.id;
            mensagem = update.callback_query.message;
            texto = update.callback_query.data;
            chatId = mensagem.chat.id;
            userId = update.callback_query.from.id;
        } else if (update.message) {
            mensagem = update.message;
            texto = mensagem.text || mensagem.caption || "";
            chatId = mensagem.chat.id;
            userId = mensagem.from.id;
        } else {
            return new Response("OK", { status: 200 });
        }

        const enviarMensagem = async (textoResposta, teclado = null) => {
            let body = { chat_id: chatId, text: textoResposta, parse_mode: "HTML", disable_web_page_preview: true };
            if (teclado) body.reply_markup = { inline_keyboard: teclado };
            const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
            return await res.json();
        };

        const editarMensagemEspecifica = async (msgId, textoResposta, teclado = null) => {
            let body = { chat_id: chatId, message_id: msgId, text: textoResposta, parse_mode: "HTML", disable_web_page_preview: true };
            if (teclado) body.reply_markup = { inline_keyboard: teclado };
            await fetch(`https://api.telegram.org/bot${botToken}/editMessageText`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        };

        const editarMensagem = async (textoResposta, teclado = null) => {
            await editarMensagemEspecifica(mensagem.message_id, textoResposta, teclado);
        };

        const deletarMensagem = async (msgId) => {
            try {
                await fetch(`https://api.telegram.org/bot${botToken}/deleteMessage`, {
                    method: "POST", headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ chat_id: chatId, message_id: msgId })
                });
            } catch (e) {}
        };

        const responderCallback = async (aviso = "") => {
            let body = { callback_query_id: callbackId };
            if (aviso) body.text = aviso;
            await fetch(`https://api.telegram.org/bot${botToken}/answerCallbackQuery`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        };

        // ==========================================================
        // 🔐 GERENCIADOR GUIADO DE ANÚNCIOS (/send)
        // ==========================================================
        if (texto.startsWith("/send") || texto.startsWith("adv_")) {
            if (String(userId) !== "7717528550") {
                await enviarMensagem("❌ Acesso negado.");
                return new Response("OK", { status: 200 });
            }

            if (texto.startsWith("/send")) {
                if (update.message) await deletarMensagem(update.message.message_id);

                let resMenu = await enviarMensagem(
                    "📢 <b>NOVO ANÚNCIO / BANNER (Horário de Brasília)</b>\n\n" +
                    "Por favor, envie o conteúdo da postagem agora.\n\n" +
                    "<i>Suporta emojis premium via tag HTML! Ex:</i>\n" +
                    "<code>&lt;tg-emoji emoji-id=\"ID_AQUI\"&gt;⭐&lt;/tg-emoji&gt;</code>\n\n" +
                    "<b>Formatos:</b>\n" +
                    "• Somente Texto\n" +
                    "• Foto / Vídeo / GIF / Sticker com ou sem legenda",
                    [[{ text: "❌ Cancelar", callback_data: "adv_cancel" }]]
                );

                if (resMenu.ok) {
                    await env.GOLS_FLAMENGO_KV.put(`adv_main_msg_${userId}`, String(resMenu.result.message_id));
                    await env.GOLS_FLAMENGO_KV.put(`adv_state_${userId}`, "waiting_content");
                }
                return new Response("OK", { status: 200 });
            }

            let mainMsgId = await env.GOLS_FLAMENGO_KV.get(`adv_main_msg_${userId}`);
            let rawDraft = await env.GOLS_FLAMENGO_KV.get(`adv_draft_${userId}`);
            let draft = rawDraft ? JSON.parse(rawDraft) : null;

            if (texto === "adv_render_panel") {
                await responderCallback();
                await renderizarPainelAnuncio(env, botToken, userId, chatId, mainMsgId, draft);
                return new Response("OK", { status: 200 });
            }

            if (texto.startsWith("adv_layout_")) {
                let layoutChoice = texto.replace("adv_layout_", "");
                draft.layout = layoutChoice;
                await env.GOLS_FLAMENGO_KV.put(`adv_draft_${userId}`, JSON.stringify(draft));
                await responderCallback(`Layout: ${layoutChoice} por linha.`);
                await renderizarPainelAnuncio(env, botToken, userId, chatId, mainMsgId, draft);
            }

            else if (texto === "adv_toggle_pin") {
                draft.pin = !draft.pin;
                await env.GOLS_FLAMENGO_KV.put(`adv_draft_${userId}`, JSON.stringify(draft));
                await responderCallback(draft.pin ? "Fixar ativado!" : "Fixar desativado!");
                await renderizarPainelAnuncio(env, botToken, userId, chatId, mainMsgId, draft);
            }

            else if (texto === "adv_add_btn") {
                await responderCallback();
                await env.GOLS_FLAMENGO_KV.put(`adv_state_${userId}`, "waiting_button");
                await editarMensagemEspecifica(mainMsgId,
                    "🔘 <b>ADICIONAR BOTÃO INLINE</b>\n\n" +
                    "Envie no chat no formato:\n\n" +
                    "<code>Texto do Botão | https://link.com</code>",
                    [
                        [{ text: "🔙 Voltar ao Painel", callback_data: "adv_render_panel" }],
                        [{ text: "❌ Cancelar Anúncio", callback_data: "adv_cancel" }]
                    ]
                );
                return new Response("OK", { status: 200 });
            }

            else if (texto === "adv_set_schedule") {
                await responderCallback();
                const txtSch = "⏰ <b>PROGRAMAÇÃO (Horário de Brasília UTC-3)</b>\n\nEscolha o tipo de agendamento:";
                const kbSch = [
                    [{ text: "➡️ Envio Único Agendado", callback_data: "adv_mode_once" }],
                    [{ text: "🔄 Diariamente", callback_data: "adv_mode_daily" }],
                    [{ text: "📅 Semanalmente", callback_data: "adv_mode_weekly" }],
                    [{ text: "📆 Mensalmente", callback_data: "adv_mode_monthly" }],
                    [{ text: "🗓 Anualmente", callback_data: "adv_mode_yearly" }],
                    [{ text: "🔙 Voltar ao Painel", callback_data: "adv_render_panel" }],
                    [{ text: "❌ Cancelar Anúncio", callback_data: "adv_cancel" }]
                ];
                await editarMensagemEspecifica(mainMsgId, txtSch, kbSch);
                return new Response("OK", { status: 200 });
            }

            else if (texto.startsWith("adv_mode_")) {
                let mode = texto.replace("adv_mode_", "");
                draft.recurrence = mode;
                await env.GOLS_FLAMENGO_KV.put(`adv_draft_${userId}`, JSON.stringify(draft));
                await env.GOLS_FLAMENGO_KV.put(`adv_state_${userId}`, "waiting_schedule_times");
                await responderCallback();

                let instrucao = "";
                if (mode === "once") {
                    instrucao = "Informe o horário no padrão de Brasília (DD/MM/AAAA HH:MM).\n\n<code>DD/MM/AAAA HH:MM | DD/MM/AAAA HH:MM</code>\n\n<i>Exemplo: 15/08/2026 14:00 | 18/08/2026 18:00</i>\n(Envie apenas a 1ª data caso não deseje auto-remoção).";
                } else if (mode === "daily") {
                    instrucao = "Informe o horário de Brasília e a data limite final:\n\n<code>HH:MM | DD/MM/AAAA</code>\n\n<i>Exemplo: 10:00 | 31/12/2026</i>";
                } else if (mode === "weekly") {
                    instrucao = "Informe o dia da semana (0=Dom, 1=Seg, 2=Ter...), horário de Brasília e data limite:\n\n<code>DIA | HH:MM | DD/MM/AAAA</code>\n\n<i>Exemplo: 1 | 20:00 | 31/12/2026</i>";
                } else if (mode === "monthly") {
                    instrucao = "Informe o dia do mês, horário de Brasília e data limite:\n\n<code>DIA | HH:MM | DD/MM/AAAA</code>\n\n<i>Exemplo: 5 | 09:00 | 31/12/2026</i>";
                } else if (mode === "yearly") {
                    instrucao = "Informe o dia/mês, horário de Brasília e data limite:\n\n<code>DD/MM | HH:MM | DD/MM/AAAA</code>\n\n<i>Exemplo: 25/12 | 12:00 | 31/12/2030</i>";
                }

                await editarMensagemEspecifica(mainMsgId, 
                    `📅 <b>DEFINIR AGENDAMENTO (${mode.toUpperCase()})</b>\n\n${instrucao}`, 
                    [
                        [{ text: "🔙 Voltar ao Agendamento", callback_data: "adv_set_schedule" }],
                        [{ text: "❌ Cancelar Anúncio", callback_data: "adv_cancel" }]
                    ]
                );
                return new Response("OK", { status: 200 });
            }

            else if (texto === "adv_send_now") {
                await responderCallback("Publicando...");
                let msgIdCreated = await dispararAnuncioNoCanal(env, botToken, draft);
                await env.GOLS_FLAMENGO_KV.delete(`adv_draft_${userId}`);
                await env.GOLS_FLAMENGO_KV.delete(`adv_state_${userId}`);
                await env.GOLS_FLAMENGO_KV.delete(`adv_main_msg_${userId}`);
                
                if (msgIdCreated) {
                    await editarMensagemEspecifica(mainMsgId, "✅ <b>Anúncio publicado com sucesso no canal @Flamengo77!</b>");
                } else {
                    await editarMensagemEspecifica(mainMsgId, "❌ <b>Erro ao publicar anúncio. Verifique se o bot é administrador do canal.</b>");
                }
                return new Response("OK", { status: 200 });
            }

            else if (texto === "adv_cancel") {
                await env.GOLS_FLAMENGO_KV.delete(`adv_draft_${userId}`);
                await env.GOLS_FLAMENGO_KV.delete(`adv_state_${userId}`);
                await env.GOLS_FLAMENGO_KV.delete(`adv_main_msg_${userId}`);
                if (isCallback) await editarMensagem("❌ <b>Criação de anúncio cancelada.</b>");
                return new Response("OK", { status: 200 });
            }
        }

        // ==========================================================
        // 🔐 INTERCEPTAÇÃO E CAPTURA GUIADA
        // ==========================================================
        let adminState = await env.GOLS_FLAMENGO_KV.get(`adv_state_${userId}`);
        if (adminState && String(userId) === "7717528550" && update.message) {
            let userMsgId = update.message.message_id;
            let mainMsgId = await env.GOLS_FLAMENGO_KV.get(`adv_main_msg_${userId}`);

            if (adminState === "waiting_content") {
                await deletarMensagem(userMsgId);

                let targetMsg = update.message;
                let draft = {
                    type: targetMsg.photo ? "photo" : targetMsg.video ? "video" : targetMsg.animation ? "animation" : targetMsg.sticker ? "sticker" : "text",
                    text: targetMsg.text || targetMsg.caption || "",
                    file_id: targetMsg.photo ? targetMsg.photo[targetMsg.photo.length - 1].file_id : targetMsg.video?.file_id || targetMsg.animation?.file_id || targetMsg.sticker?.file_id || null,
                    buttons: [],
                    layout: "1",
                    pin: false,
                    recurrence: "IMEDIATO"
                };

                await env.GOLS_FLAMENGO_KV.put(`adv_draft_${userId}`, JSON.stringify(draft));
                await env.GOLS_FLAMENGO_KV.delete(`adv_state_${userId}`);
                await renderizarPainelAnuncio(env, botToken, userId, chatId, mainMsgId, draft);
                return new Response("OK", { status: 200 });
            }

            let rawDraft = await env.GOLS_FLAMENGO_KV.get(`adv_draft_${userId}`);
            let draft = rawDraft ? JSON.parse(rawDraft) : null;

            if (adminState === "waiting_button" && draft) {
                await deletarMensagem(userMsgId);
                if (texto.includes("|")) {
                    let partes = texto.split("|");
                    draft.buttons.push({ text: partes[0].trim(), url: partes[1].trim() });
                    await env.GOLS_FLAMENGO_KV.put(`adv_draft_${userId}`, JSON.stringify(draft));
                    await env.GOLS_FLAMENGO_KV.delete(`adv_state_${userId}`);
                    await renderizarPainelAnuncio(env, botToken, userId, chatId, mainMsgId, draft);
                } else {
                    await editarMensagemEspecifica(mainMsgId, 
                        "❌ <b>Formato Inválido!</b>\n\nEnvie no formato:\n<code>Texto do Botão | https://link.com</code>", 
                        [
                            [{ text: "🔙 Voltar ao Painel", callback_data: "adv_render_panel" }],
                            [{ text: "❌ Cancelar Anúncio", callback_data: "adv_cancel" }]
                        ]
                    );
                }
                return new Response("OK", { status: 200 });
            }

            if (adminState === "waiting_schedule_times" && draft) {
                await deletarMensagem(userMsgId);
                let p = texto.split("|").map(s => s.trim());
                try {
                    if (draft.recurrence === "once") {
                        draft.publish_at = parseDateStringToTimestampBrasilia(p[0]);
                        if (p[1]) draft.expire_at = parseDateStringToTimestampBrasilia(p[1]);
                    } else if (draft.recurrence === "daily") {
                        draft.time = p[0];
                        draft.until = parseDateStringToTimestampBrasilia(p[1] + " 23:59");
                    } else if (draft.recurrence === "weekly" || draft.recurrence === "monthly") {
                        draft.day = p[0];
                        draft.time = p[1];
                        draft.until = parseDateStringToTimestampBrasilia(p[2] + " 23:59");
                    } else if (draft.recurrence === "yearly") {
                        draft.date_day_month = p[0];
                        draft.time = p[1];
                        draft.until = parseDateStringToTimestampBrasilia(p[2] + " 23:59");
                    }

                    let advId = "adv_" + Date.now();
                    let anunciosSalvosRaw = await env.GOLS_FLAMENGO_KV.get("ANUNCIOS_AGENDADOS");
                    let anunciosSalvos = anunciosSalvosRaw ? JSON.parse(anunciosSalvosRaw) : [];
                    anunciosSalvos.push({ id: advId, draft: draft });
                    
                    await env.GOLS_FLAMENGO_KV.put("ANUNCIOS_AGENDADOS", JSON.stringify(anunciosSalvos));
                    await env.GOLS_FLAMENGO_KV.delete(`adv_draft_${userId}`);
                    await env.GOLS_FLAMENGO_KV.delete(`adv_state_${userId}`);

                    await editarMensagemEspecifica(mainMsgId, "✅ <b>ANÚNCIO PROGRAMADO COM SUCESSO!</b>\n\nHorário sincronizado com o fuso de Brasília (UTC-3).");
                } catch (e) {
                    await editarMensagemEspecifica(mainMsgId, 
                        "❌ <b>Erro na Data/Hora:</b> " + e.message, 
                        [
                            [{ text: "🔙 Tentar Novamente", callback_data: "adv_set_schedule" }],
                            [{ text: "❌ Cancelar Anúncio", callback_data: "adv_cancel" }]
                        ]
                    );
                }
                return new Response("OK", { status: 200 });
            }
        }

        return new Response("OK", { status: 200 });

    } catch (erro) {
        console.error("ERRO GRAVE INTERNO:", erro.message);
        return new Response("OK", { status: 200 });
    }
}

// ==========================================================
// 🛠 AUXILIARES DO GERENCIADOR DE ANÚNCIOS
// ==========================================================

async function renderizarPainelAnuncio(env, botToken, userId, chatId, mainMsgId, draft) {
    const txtInfo = `⚙️ <b>PAINEL DO ANÚNCIO / BANNER</b>\n\n` +
                    `📱 <b>Tipo de Mídia:</b> ${draft.type.toUpperCase()}\n` +
                    `📝 <b>Legenda/Texto:</b> ${draft.text ? `<i>"${draft.text.substring(0, 40)}..."</i>` : "Nenhum"}\n` +
                    `🔘 <b>Botões Adicionados:</b> ${draft.buttons.length}\n` +
                    `📐 <b>Layout Selecionado:</b> ${draft.layout} botão(ões) por linha\n` +
                    `📌 <b>Fixar no Canal:</b> ${draft.pin ? "SIM" : "NÃO"}\n` +
                    `⏰ <b>Programação:</b> ${draft.recurrence.toUpperCase()}\n\n` +
                    `Escolha abaixo para ajustar as configurações:`;

    const keyboard = [
        [{ text: "➕ Adicionar Botão URL", callback_data: "adv_add_btn" }],
        [
            { text: draft.layout === "1" ? "✅ 1 p/ Linha" : "1 p/ Linha", callback_data: "adv_layout_1" },
            { text: draft.layout === "2" ? "✅ 2 p/ Linha" : "2 p/ Linha", callback_data: "adv_layout_2" },
            { text: draft.layout === "3" ? "✅ 3 p/ Linha" : "3 p/ Linha", callback_data: "adv_layout_3" }
        ],
        [{ text: draft.pin ? "📌 Desafixar Mensagem" : "📌 Fixar Mensagem", callback_data: "adv_toggle_pin" }],
        [{ text: "⏰ Definir Agendamento / Programação", callback_data: "adv_set_schedule" }],
        [{ text: "🚀 ENVIAR AGORA", callback_data: "adv_send_now" }],
        [{ text: "❌ Cancelar Anúncio", callback_data: "adv_cancel" }]
    ];

    let body = { chat_id: chatId, message_id: mainMsgId, text: txtInfo, parse_mode: "HTML", reply_markup: { inline_keyboard: keyboard } };
    await fetch(`https://api.telegram.org/bot${botToken}/editMessageText`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

async function dispararAnuncioNoCanal(env, botToken, draft) {
    const canal = "@Flamengo77";
    let inline_keyboard = [];

    if (draft.buttons && draft.buttons.length > 0) {
        let perRow = parseInt(draft.layout || "1");
        for (let i = 0; i < draft.buttons.length; i += perRow) {
            let row = draft.buttons.slice(i, i + perRow).map(b => ({ text: b.text, url: b.url }));
            inline_keyboard.push(row);
        }
    }

    let payload = {
        chat_id: canal,
        parse_mode: "HTML",
        reply_markup: inline_keyboard.length > 0 ? { inline_keyboard } : undefined
    };

    let endpoint = "sendMessage";
    if (draft.type === "photo") { endpoint = "sendPhoto"; payload.photo = draft.file_id; payload.caption = draft.text; }
    else if (draft.type === "video") { endpoint = "sendVideo"; payload.video = draft.file_id; payload.caption = draft.text; }
    else if (draft.type === "animation") { endpoint = "sendAnimation"; payload.animation = draft.file_id; payload.caption = draft.text; }
    else if (draft.type === "sticker") { endpoint = "sendSticker"; payload.sticker = draft.file_id; }
    else { payload.text = draft.text; }

    const res = await fetch(`https://api.telegram.org/bot${botToken}/${endpoint}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    });

    const data = await res.json();

    if (data.ok && draft.pin) {
        try {
            await fetch(`https://api.telegram.org/bot${botToken}/pinChatMessage`, {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ chat_id: canal, message_id: data.result.message_id, disable_notification: false })
            });
        } catch (e) {}
    }

    return data.ok ? data.result.message_id : null;
}

async function processarAgendamentosAnuncios(env) {
    let raw = await env.GOLS_FLAMENGO_KV.get("ANUNCIOS_AGENDADOS");
    if (!raw) return;

    let anuncios = JSON.parse(raw);
    let agora = Date.now();
    let atualizados = [];

    for (let item of anuncios) {
        let draft = item.draft;

        if (draft.until && agora > draft.until) continue;

        if (draft.recurrence === "once") {
            if (draft.publish_at && agora >= draft.publish_at && !item.published_msg_id) {
                let msgId = await dispararAnuncioNoCanal(env, env.TELEGRAM_TOKEN, draft);
                if (msgId) item.published_msg_id = msgId;
            }

            if (draft.expire_at && agora >= draft.expire_at && item.published_msg_id) {
                try {
                    await fetch(`https://api.telegram.org/bot${env.TELEGRAM_TOKEN}/deleteMessage`, {
                        method: "POST", headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ chat_id: "@Flamengo77", message_id: item.published_msg_id })
                    });
                } catch (e) {}
                continue;
            }
        }
        
        atualizados.push(item);
    }

    await env.GOLS_FLAMENGO_KV.put("ANUNCIOS_AGENDADOS", JSON.stringify(atualizados));
}

// Converte a string inserida considerando o Fuso Horário de Brasília (UTC-3)
function parseDateStringToTimestampBrasilia(str) {
    let [data, hora] = str.trim().split(" ");
    let [dia, mes, ano] = data.split("/");
    let [h, m] = hora ? hora.split(":") : ["00", "00"];
    
    // ISO String formatada explicitamente no offset -03:00 de Brasília
    let isoFormatted = `${ano}-${mes.padStart(2, '0')}-${dia.padStart(2, '0')}T${h.padStart(2, '0')}:${m.padStart(2, '0')}:00-03:00`;
    return new Date(isoFormatted).getTime();
}
