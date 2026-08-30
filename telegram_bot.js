// ==========================================================
// ⚙️ HELPERS PARA TABELA DE CONFIGURAÇÕES (D1)
// ==========================================================
async function getConfig(db, chave) {
    const row = await db.prepare("SELECT valor FROM config WHERE chave = ?").bind(chave).first();
    return row ? row.valor : null;
}

async function setConfig(db, chave, valor) {
    await db.prepare("INSERT OR REPLACE INTO config (chave, valor) VALUES (?, ?)").bind(chave, String(valor)).run();
}

async function deleteConfig(db, chave) {
    await db.prepare("DELETE FROM config WHERE chave = ?").bind(chave).run();
}

// ==========================================================
// ⚙️ FUNÇÃO AUXILIAR: PROCESSA FOTOS EM LOTES DE 5 POR CLIQUE
// ==========================================================
async function processarLoteFotos(offset, chatId, env, botToken, eEdicao = false, messageId = null) {
    const totalRow = await env.DB.prepare("SELECT COUNT(*) as total FROM usuarios WHERE pontos > 0").first();
    const total = totalRow?.total || 0;

    const TAMANHO_LOTE = 5;
    const { results: lote } = await env.DB.prepare(`
        SELECT id FROM usuarios 
        WHERE pontos > 0 
        ORDER BY pontos DESC 
        LIMIT ? OFFSET ?
    `).bind(TAMANHO_LOTE, offset).all();

    let atualizadosNoLote = 0;
    let semFotoNoLote = 0;

    await Promise.all(lote.map(async (u) => {
        try {
            const photosRes = await fetch(`https://api.telegram.org/bot${botToken}/getUserProfilePhotos?user_id=${u.id}&limit=1`);
            const photosData = await photosRes.json();

            if (photosData.ok && photosData.result?.photos?.length > 0) {
                const fileId = photosData.result.photos[0][0].file_id;
                const fileRes = await fetch(`https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`);
                const fileData = await fileRes.json();

                if (fileData.ok && fileData.result?.file_path) {
                    const photoUrl = `https://api.telegram.org/file/bot${botToken}/${fileData.result.file_path}`;
                    await setConfig(env.DB, `profile_photo_url_${u.id}`, photoUrl);
                    await setConfig(env.DB, `profile_photo_file_id_${u.id}`, fileId);
                    await env.DB.prepare("UPDATE usuarios SET foto_url = ?, foto_file_id = ? WHERE id = ?").bind(photoUrl, fileId, u.id).run();
                    atualizadosNoLote++;
                } else {
                    semFotoNoLote++;
                }
            } else {
                semFotoNoLote++;
            }
        } catch (e) {
            semFotoNoLote++;
        }
    }));

    let proximoOffset = offset + TAMANHO_LOTE;
    let concluido = proximoOffset >= total;
    let progressoAtual = Math.min(proximoOffset, total);

    let textoResposta = 
        `🖼 <b>SINCRONIZAÇÃO DE FOTOS (${progressoAtual}/${total})</b>\n\n` +
        `• Lote atual: <code>${offset + 1}</code> até <code>${progressoAtual}</code>\n` +
        `• Com foto registrada: <b>${atualizadosNoLote}</b>\n` +
        `• Sem foto pública: <b>${semFotoNoLote}</b>\n\n` +
        (concluido 
            ? `🎉 <b>Processamento de todos os ${total} torcedores concluído com sucesso!</b>` 
            : `👉 Clique no botão abaixo para processar os próximos 5 torcedores.`);

    let teclado = null;
    if (!concluido) {
        teclado = [
            [{ text: `▶️ Continuar (${progressoAtual + 1} ao ${Math.min(progressoAtual + 5, total)})`, callback_data: `fotos_page_${proximoOffset}` }]
        ];
    }

    if (eEdicao && messageId) {
        await fetch(`https://api.telegram.org/bot${botToken}/editMessageText`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                chat_id: chatId,
                message_id: messageId,
                text: textoResposta,
                parse_mode: "HTML",
                reply_markup: teclado ? { inline_keyboard: teclado } : undefined
            })
        });
    } else {
        await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                chat_id: chatId,
                text: textoResposta,
                parse_mode: "HTML",
                reply_markup: teclado ? { inline_keyboard: teclado } : undefined
            })
        });
    }
}

// ==========================================================
// 📥 FLUXO PRINCIPAL DO TELEGRAM
// ==========================================================
export async function processarMensagemTelegram(request, env, botTokenPassado) {
    const botToken = botTokenPassado || env.TELEGRAM_TOKEN; 

    try {
        const update = await request.json();

        // ==========================================================
        // ⚡ MODO INLINE QUERY (Ordenação Recente > Antigo no D1)
        // ==========================================================
        if (update.inline_query) {
            const inlineQuery = update.inline_query;
            const busca = inlineQuery.query || "";
            const queryId = inlineQuery.id;
            const offset = parseInt(inlineQuery.offset || "0") || 0;
            const uidTelegram = Number(inlineQuery.from.id);
            
            const userDb = await env.DB.prepare("SELECT idioma FROM usuarios WHERE id = ?").bind(uidTelegram).first();
            let lang = "pt";

            if (userDb?.idioma && ["pt", "en", "es"].includes(userDb.idioma.toLowerCase())) {
                lang = userDb.idioma.toLowerCase();
            } else {
                let userLangCode = String(inlineQuery.from.language_code || "pt").toLowerCase();
                if (userLangCode.startsWith("en")) lang = "en";
                else if (userLangCode.startsWith("es")) lang = "es";
            }

            const texts = {
                pt: { search_title: "🔍 Buscar Gols", search_desc: "Digite jogador, time ou campeonato", search_msg: "🔍 <b>BUSCA DE GOLS ⚽</b>\n\nDigite palavras-chave como:\n• Pedro\n• Flamengo\n• Libertadores\n• Brasileirão\n\n⚠️ <b>Para ver todos os gols:</b>\n👉 Digite: <code>Flamengo</code>", list_title: "📋 Lista completa de gols", list_desc: "Clique para ver todos os gols do Flamengo", list_msg: "📋 <b>LISTA COMPLETA ⚽</b>\n\nPara ver todos os gols:\n👉 Digite: <code>Flamengo</code>", btn_search: "🔎 Buscar", btn_all: "📋 Ver todos os gols", btn_all_query: "Flamengo" },
                en: { search_title: "🔍 Search Goals", search_desc: "Type player, team or competition", search_msg: "🔍 <b>GOALS SEARCH ⚽</b>\n\nType keywords like:\n• Pedro\n• Flamengo\n• Libertadores\n\n⚠️ <b>To see all goals:</b>\n👉 Type: <code>Flamengo</code>", list_title: "📋 Full goals list", list_desc: "Click to see all Flamengo goals", list_msg: "📋 <b>FULL LIST ⚽</b>\n\nTo see all goals:\n👉 Type: <code>Flamengo</code>", btn_search: "🔎 Search", btn_all: "📋 View all goals", btn_all_query: "Flamengo" },
                es: { search_title: "🔍 Buscar Goles", search_desc: "Escribe jugador, equipo o competición", search_msg: "🔍 <b>BÚSQUEDA DE GOLES ⚽</b>\n\nEscribe palabras clave como:\n• Pedro\n• Flamengo\n• Libertadores\n\n⚠️ <b>Para ver todos los goles:</b>\n👉 Escribe: <code>Flamengo</code>", list_title: "📋 Lista completa de goles", list_desc: "Haz clic para ver todos los goles", list_msg: "📋 <b>LISTA COMPLETA ⚽</b>\n\nPara ver todos os goles:\n👉 Escribe: <code>Flamengo</code>", btn_search: "🔎 Buscar", btn_all: "📋 Ver todos os goles", btn_all_query: "Flamengo" }
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

            const MAX_RESULTS = 50;
            const querySql = `%${buscaNorm}%`;

            const { results: golsDb } = await env.DB.prepare(`
                SELECT * FROM gols 
                WHERE jogo LIKE ? OR autor LIKE ? OR assistencia LIKE ? OR campeonato LIKE ? OR fase LIKE ?
                ORDER BY CAST(criado_em AS INTEGER) DESC, CAST(id AS INTEGER) DESC 
                LIMIT ? OFFSET ?
            `).bind(querySql, querySql, querySql, querySql, querySql, MAX_RESULTS, offset).all();

            const resultados = golsDb.map((gol) => {
                return {
                    type: "video",
                    id: `vid_${gol.id}_${offset}`,
                    video_file_id: gol.file_id,
                    title: gol.jogo || "Gol",
                    description: `⚽️ ${gol.autor || "-"} | 🏆 ${gol.campeonato || "-"}`,
                    caption: `<b>${gol.jogo || ""}</b>\n\n⚽️ ${gol.autor || "-"}\n🅰 ${gol.assistencia || "-"}\n\n🏆 ${gol.campeonato || "-"} - ${gol.fase || "-"}\n\n🤖 @FlamengoGolsBot`,
                    parse_mode: "HTML"
                };
            });

            const proximoOffset = resultados.length === MAX_RESULTS ? String(offset + MAX_RESULTS) : "";
            await responderInline(resultados, proximoOffset);
            return new Response("OK", { status: 200 });
        }

        // ==========================================================
        // 🔘 MODO MENSAGEM OU CALLBACK
        // ==========================================================
        let mensagem, texto, chatId, userId, userFirstName, userLastName, isCallback = false, callbackId;

        if (update.callback_query) {
            isCallback = true;
            callbackId = update.callback_query.id;
            mensagem = update.callback_query.message;
            texto = update.callback_query.data;
            chatId = mensagem.chat.id;
            userId = update.callback_query.from.id;
            userFirstName = update.callback_query.from.first_name || "Torcedor";
            userLastName = update.callback_query.from.last_name || "";
        } else if (update.message) {
            mensagem = update.message;
            texto = mensagem.text || mensagem.caption || "";
            chatId = mensagem.chat.id;
            userId = mensagem.from.id;
            userFirstName = mensagem.from.first_name || "Torcedor"; 
            userLastName = mensagem.from.last_name || "";   
        } else {
            return new Response("OK", { status: 200 });
        }

        const sanitizarNome = (str) => {
            if (!str) return "Torcedor";
            return str
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;")
                .replace(/[\u0000-\u001F\u007F-\u009F\uFFFD]/g, "")
                .trim() || "Torcedor";
        };

        const realName = sanitizarNome(`${userFirstName} ${userLastName}`);
        const escHTML = (text) => String(text || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        const mention = `<a href="tg://user?id=${userId}">${realName}</a>`;

        const enviarMensagem = async (textoResposta, teclado = null) => {
            let body = { chat_id: chatId, text: textoResposta, parse_mode: "HTML", disable_web_page_preview: true };
            if (teclado) body.reply_markup = { inline_keyboard: teclado };
            const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
            return await res.json();
        };

        const editarMensagem = async (textoResposta, teclado = null) => {
            let body = { chat_id: chatId, message_id: mensagem.message_id, text: textoResposta, parse_mode: "HTML", disable_web_page_preview: true };
            if (teclado) body.reply_markup = { inline_keyboard: teclado };
            const res = await fetch(`https://api.telegram.org/bot${botToken}/editMessageText`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
            return await res.json();
        };

        const responderCallback = async (aviso = "") => {
            let body = { callback_query_id: callbackId };
            if (aviso) body.text = aviso;
            await fetch(`https://api.telegram.org/bot${botToken}/answerCallbackQuery`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        };

        let userRaw = await env.DB.prepare("SELECT * FROM usuarios WHERE id = ?").bind(userId).first();
        let lang = userRaw?.idioma || (update.callback_query ? update.callback_query.from.language_code : update.message.from.language_code) || "pt";
        lang = lang.substring(0, 2).toLowerCase();
        if (!["pt", "en", "es"].includes(lang)) lang = "pt";

        if (!userRaw) {
            await env.DB.prepare(`
                INSERT INTO usuarios (id, nome, idioma, pontos, criado_em)
                VALUES (?, ?, ?, 0, ?)
            `).bind(userId, realName, lang, Date.now()).run();
        } else if (userRaw.nome !== realName && realName !== "Torcedor") {
            await env.DB.prepare("UPDATE usuarios SET nome = ? WHERE id = ?").bind(realName, userId).run();
        }

        const totalUsersRow = await env.DB.prepare("SELECT COUNT(*) as total FROM usuarios").first();
        const totalUsers = totalUsersRow?.total || 1;

        if (texto.startsWith("set_lang_")) {
            lang = texto.replace("set_lang_", "");
            await env.DB.prepare("UPDATE usuarios SET idioma = ? WHERE id = ?").bind(lang, userId).run();
            const avisos = { pt: "Idioma alterado! 🇧🇷", en: "Language changed! 🇺🇸", es: "¡Idioma cambiado! 🇪🇸" };
            await responderCallback(avisos[lang]);
            texto = "menu_principal";
        }

        if (texto === "change_lang") {
            const txtIdioma = { pt: "🌐 Selecione o seu idioma:", en: "🌐 Select your language:", es: "🌐 Seleccione su idioma:" };
            const tecladoIdioma = [
                [{ text: "🇧🇷 Português", callback_data: "set_lang_pt" }],
                [{ text: "🇺🇸 English", callback_data: "set_lang_en" }],
                [{ text: "🇪🇸 Español", callback_data: "set_lang_es" }],
                [{ text: lang === "pt" ? "🔙 Voltar" : lang === "en" ? "🔙 Back" : "🔙 Volver", callback_data: "menu_principal" }]
            ];
            if (isCallback) await editarMensagem(txtIdioma[lang], tecladoIdioma);
            return new Response("OK", { status: 200 });
        }

        if (texto === "suporte_bot") {
            if (isCallback) await responderCallback();
            const textosSuporte = {
                pt: `🛠 <b>Suporte ao Usuário</b>\n\nPrecisa de ajuda ou encontrou algum problema?\n\n👉 Entre em contato diretamente com o nosso administrador clicando no botão abaixo ou envie uma mensagem para o suporte oficial.`,
                en: `🛠 <b>User Support</b>\n\nNeed help or found a bug?\n\n👉 Contact our administrator directly by clicking the button below or send a message to the official support.`,
                es: `🛠 <b>Soporte de Usuario</b>\n\n¿Necesitas ayuda o encontraste um error?\n\n👉 Contacta directamente com nuestro administrador haciendo clic en el botão de abajo o envía un mensaje al soporte oficial.`
            };
            const botoesSuporte = {
                pt: { contato: "💬 Falar com Suporte", voltar: "🔙 Voltar" },
                en: { contato: "💬 Contact Support", voltar: "🔙 Back" },
                es: { contato: "💬 Contactar Soporte", voltar: "🔙 Volver" }
            };
            const btnSup = botoesSuporte[lang] || botoesSuporte.pt;
            const tecladoSuporte = [
                [{ text: btnSup.contato, url: "https://t.me/oedutg" }],
                [{ text: btnSup.voltar, callback_data: "menu_principal" }]
            ];
            if (isCallback) await editarMensagem(textosSuporte[lang], tecladoSuporte);
            else await enviarMensagem(textosSuporte[lang], tecladoSuporte);
            return new Response("OK", { status: 200 });
        }

        // ==========================================================
        // ⚡ COMANDOS PRINCIPAIS (/start com Deep Link de Resgate, /ajuda)
        // ==========================================================
        if (texto.startsWith("/start") || texto === "menu_principal") {
            if (isCallback && texto !== "menu_principal") await responderCallback();

            // 🎯 1. DEEP LINK DE RESGATE (/start resgatar_ID)
            if (texto.startsWith("/start resgatar_")) {
                let params = texto.replace("/start", "").trim();
                let postagemId = params.replace("resgatar_", "").trim();
                
                let confronto = (await getConfig(env.DB, "confronto_" + postagemId)) || (await getConfig(env.DB, "confronto_atual")) || "Partida não informada";
                let resultadoOficial = (await getConfig(env.DB, "resultado_oficial_" + postagemId)) || "Resultado ainda não informado";
                let encerradoEm = Number(await getConfig(env.DB, "bolao_encerrado_em_" + postagemId)) || 0;
                
                let umaHora = 60 * 60 * 1000;
                let aindaEmRevisao = Date.now() - encerradoEm < umaHora;

                const meuPalpiteRow = await env.DB.prepare("SELECT palpite FROM palpites WHERE postagem_id = ? AND user_id = ?").bind(postagemId, userId).first();
                let textoPalpite = meuPalpiteRow?.palpite ? `\n📌 Seu palpite: <b>${escHTML(meuPalpiteRow.palpite)}</b>` : "";

                let winnersRaw = await getConfig(env.DB, "vencedores_ids_" + postagemId);
                let vencedoresIds = winnersRaw ? JSON.parse(winnersRaw) : [];
                let ganhou = vencedoresIds.includes(String(userId));

                let chaveResgateConcluido = "resgate_concluido_" + postagemId + "_" + userId;
                let jaResgatou = await getConfig(env.DB, chaveResgateConcluido);

                if (jaResgatou === "true") {
                    await enviarMensagem(`✅ ${mention}, você já resgatou este ponto do Flamengo.\n\n🏟 <b>Bolão:</b> ${escHTML(confronto)}\n⚽ <b>Resultado:</b> ${escHTML(resultadoOficial)}${textoPalpite}`);
                    return new Response("OK", { status: 200 });
                }

                if (ganhou) {
                    await setConfig(env.DB, chaveResgateConcluido, "true");
                    await env.DB.prepare("UPDATE usuarios SET pontos = pontos + 1 WHERE id = ?").bind(userId).run();

                    await env.DB.prepare(`
                        INSERT INTO acertos (postagem_id, user_id, confronto, placar, resgatado, resgatado_em)
                        VALUES (?, ?, ?, ?, 1, ?)
                        ON CONFLICT(postagem_id, user_id) DO UPDATE SET resgatado = 1, resgatado_em = excluded.resgatado_em
                    `).bind(postagemId, userId, confronto, resultadoOficial, Date.now()).run();
                    
                    const userAtualizado = await env.DB.prepare("SELECT pontos FROM usuarios WHERE id = ?").bind(userId).first();
                    const acertos = userAtualizado?.pontos || 1;
                    
                    let jaVerificou = await getConfig(env.DB, "resgate_verificado_" + postagemId + "_" + userId);
                    let textoExtra = jaVerificou === "true" ? "\n🛠 Seu acerto foi reconhecido após a conferência manual." : "";
                    
                    await enviarMensagem(`🎯 ${mention}, seu acerto foi reconhecido! ❤️🖤\n\n🏆 <b>Bolão:</b> ${escHTML(confronto)}\n⚽ <b>Resultado:</b> ${escHTML(resultadoOficial)}${textoPalpite}\n\n✅ Status: <b>Você ganhou!</b>${textoExtra}\n\n➕ Ponto adicionado!\n📊 Total de acertos: <b>${acertos}</b>`);
                    return new Response("OK", { status: 200 });
                }

                await setConfig(env.DB, "resgate_verificado_" + postagemId + "_" + userId, "true");
                let textoRevisao = aindaEmRevisao ? "\n\n🕒 O resultado ainda está no período de revisão de 1 hora." : "";
                await enviarMensagem(`😔 ${mention}, você não faturou este bolão.\n\n🏟 <b>Bolão:</b> ${escHTML(confronto)}\n⚽ <b>Resultado:</b> ${escHTML(resultadoOficial)}${textoPalpite}\n\n❌ Status: <b>Você perdeu.</b>${textoRevisao}`);
                return new Response("OK", { status: 200 });
            }

            // 🏠 2. MENU PRINCIPAL
            const textosMenu = {
                pt: `👋 Olá ${realName}, seja muito bem-vindo(a) ao @FlamengoGolsBot! 🔴⚫\n\nAqui você encontra todos os gols dos campeonatos que o Mengão disputa.\n\n✍️ Como usar:\nDigite em qualquer chat:\n@FlamengoGolsBot Flamengo\n\n☝️ Mais comandos: /ajuda\n\n▶️ Usuários ativos: ${totalUsers}`,
                en: `👋 Hello ${realName}, welcome to @FlamengoGolsBot! 🔴⚫\n\nHere you will find goals from all the championships Flamengo plays in.\n\n✍️ How to use:\nType in any chat:\n@FlamengoGolsBot Flamengo\n\n☝️ More commands: /help\n\n▶️ Active users: ${totalUsers}`,
                es: `👋 ¡Hola ${realName}, bienvenido al @FlamengoGolsBot! 🔴⚫\n\nAquí encontrarás todos los goles de los campeonatos que disputa el Flamengo.\n\n✍️ Cómo usar:\nEscribe en qualquer chat:\n@FlamengoGolsBot Flamengo\n\n☝️ Más comandos: /ayuda\n\n▶️ Usuarios activos: ${totalUsers}`
            };

            const botoesMenu = {
                pt: { buscar: "Buscar Flamengo", livre: "Busca Livre", canal: "Canal Oficial", suporte: "Suporte 🛠", idioma: "Mudar Idioma" },
                en: { buscar: "Search Flamengo", livre: "Free Search", canal: "Official Channel", suporte: "Support 🛠", idioma: "Change Language" },
                es: { buscar: "Buscar Flamengo", livre: "Búsqueda Libre", canal: "Canal Oficial", suporte: "Soporte 🛠", idioma: "Cambiar Idioma" }
            };
            const btn = botoesMenu[lang] || botoesMenu.pt;

            const tecladoMenu = [
                [{ text: btn.buscar, switch_inline_query_current_chat: "Flamengo" }, { text: btn.livre, switch_inline_query_current_chat: "" }],
                [{ text: btn.canal, url: "https://t.me/Flamengo77" }],
                [{ text: btn.suporte, callback_data: "suporte_bot" }, { text: btn.idioma, callback_data: "change_lang" }]
            ];

            if (isCallback) await editarMensagem(textosMenu[lang], tecladoMenu);
            else await enviarMensagem(textosMenu[lang], tecladoMenu);
            return new Response("OK", { status: 200 });
        }

        else if (texto === "/ajuda" || texto === "/help" || texto === "/ayuda") {
            const textosAjuda = {
                pt: "🆘 <b>Central de Ajuda - Flamengo Gols Bot</b>\n\nBem-vindo ao bot oficial de gols do Flamengo! 🔴⚫\n\n🚀 <b>Como usar no modo inline</b>\nVocê pode buscar gols direto em qualquer chat, grupo ou conversa, sem precisar abrir o bot.\n\n<b>Passo a passo:</b>\n1️⃣ Vá para qualquer grupo\n2️⃣ Digite: <code>@FlamengoGolsBot Flamengo</code>\n3️⃣ Escolha o resultado e envie! 🎥🔥",
                en: "🆘 <b>Help Center - Flamengo Goals Bot</b>\n\nWelcome to the official Flamengo goals bot! 🔴⚫\n\n🚀 <b>How to use inline mode</b>\nSearch goals directly in any chat without opening the bot.\n\n<b>Step by step:</b>\n1️⃣ Go to any group\n2️⃣ Type: <code>@FlamengoGolsBot Flamengo</code>\n3️⃣ Choose the result and send! 🎥🔥",
                es: "🆘 <b>Centro de Ayuda - Flamengo Goles Bot</b>\n\n¡Bienvenido al bot oficial de gols del Flamengo! 🔴⚫\n\n🚀 <b>Cómo usar el modo inline</b>\nBusca goles directamente en qualquer chat sin abrir el bot.\n\n<b>Paso a passo:</b>\n1️⃣ Ve a cualquier grupo\n2️⃣ Escribe: <code>@FlamengoGolsBot Flamengo</code>\n3️⃣ ¡Elige el resultado e envía! 🎥🔥"
            };
            const tecladoAjuda = [[{ text: lang === "pt" ? "🔙 Voltar" : lang === "en" ? "🔙 Back" : "🔙 Volver", callback_data: "menu_principal" }]];
            await enviarMensagem(textosAjuda[lang], tecladoAjuda);
        }

        // ==========================================================
        // ⚡ COMANDO ADMIN: REAGIR A UMA MENSAGEM ESPECÍFICA (/reagir [emoji])
        // ==========================================================
        else if (texto.startsWith("/reagir") && !texto.startsWith("/reagir_pendentes")) {
            if (String(userId) !== "7717528550") return new Response("OK", { status: 200 });

            if (!update.message?.reply_to_message) {
                await enviarMensagem("❌ Use o comando <code>/reagir</code> <b>respondendo</b> à mensagem que deseja reagir.");
                return new Response("OK", { status: 200 });
            }

            const targetMsgId = update.message.reply_to_message.message_id;
            let emojiEscolhido = texto.replace(/^\/reagir/, "").trim() || "👍";

            try {
                await fetch(`https://api.telegram.org/bot${botToken}/setMessageReaction`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        chat_id: chatId,
                        message_id: targetMsgId,
                        reaction: [{ type: "emoji", emoji: emojiEscolhido }],
                        is_big: false
                    })
                });

                await fetch(`https://api.telegram.org/bot${botToken}/deleteMessage`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ chat_id: chatId, message_id: mensagem.message_id })
                });
            } catch (e) {
                console.error("Erro ao aplicar reação manual:", e.message);
            }

            return new Response("OK", { status: 200 });
        }

        // ==========================================================
        // 🔄 COMANDO ADMIN: REAGIR A TODOS OS PALPITES PENDENTES DO BOLÃO
        // ==========================================================
        else if (texto.startsWith("/reagir_pendentes")) {
            if (String(userId) !== "7717528550") return new Response("OK", { status: 200 });

            let postId = (await getConfig(env.DB, "postagem_ativa_id")) || (await getConfig(env.DB, "BOLAO_RESGATE_ID"));
            if (!postId) {
                await enviarMensagem("❌ Nenhum bolão ativo encontrado no momento.");
                return new Response("OK", { status: 200 });
            }

            let emojiEscolhido = texto.replace(/^\/reagir_pendentes/, "").trim() || "👍";

            const { results: palpitesSemReacao } = await env.DB.prepare(`
                SELECT user_id, mensagem_id, chat_id FROM palpites 
                WHERE postagem_id = ? AND mensagem_id IS NOT NULL AND (reagido IS NULL OR reagido = 0)
                LIMIT 50
            `).bind(postId).all();

            if (!palpitesSemReacao || palpitesSemReacao.length === 0) {
                await enviarMensagem("ℹ️ Todos os palpites cadastrados já receberam reação!");
                return new Response("OK", { status: 200 });
            }

            let reagidosCount = 0;
            for (const p of palpitesSemReacao) {
                try {
                    const targetChat = p.chat_id || chatId;
                    const res = await fetch(`https://api.telegram.org/bot${botToken}/setMessageReaction`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            chat_id: targetChat,
                            message_id: p.mensagem_id,
                            reaction: [{ type: "emoji", emoji: emojiEscolhido }],
                            is_big: false
                        })
                    });
                    const resData = await res.json();
                    if (resData.ok) {
                        await env.DB.prepare("UPDATE palpites SET reagido = 1 WHERE postagem_id = ? AND user_id = ?").bind(postId, p.user_id).run();
                        reagidosCount++;
                    }
                } catch (e) {
                    console.error("Erro ao reagir em pendente:", e.message);
                }
            }

            try {
                await fetch(`https://api.telegram.org/bot${botToken}/deleteMessage`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ chat_id: chatId, message_id: mensagem.message_id })
                });
            } catch (e) {}

            await enviarMensagem(`✅ Reação <b>${emojiEscolhido}</b> aplicada a <b>${reagidosCount}</b> palpite(s) pendente(s)!`);
            return new Response("OK", { status: 200 });
        }

                    // ==========================================================
        // 📌 COMANDO ADMIN: ATRELAR PALPITE MANUALMENTE (/salvar)
        // ==========================================================
        else if (texto.startsWith("/salvar") || texto.startsWith("/palpite")) {
            if (String(userId) !== "7717528550") return new Response("OK", { status: 200 });

            if (!update.message?.reply_to_message) {
                await enviarMensagem("❌ Responda à mensagem do torcedor com <code>/salvar</code> para registrar o palpite.");
                return new Response("OK", { status: 200 });
            }

            let postId = (await getConfig(env.DB, "postagem_ativa_id")) || (await getConfig(env.DB, "BOLAO_RESGATE_ID"));
            if (!postId) {
                await enviarMensagem("❌ Nenhum bolão ativo encontrado no momento.");
                return new Response("OK", { status: 200 });
            }

            const targetMsg = update.message.reply_to_message;
            const targetUser = targetMsg.from;
            const textoPalpite = targetMsg.text || targetMsg.caption || "";

            const match = textoPalpite.match(/\d+\s*(?:x|X|×|-|a)\s*\d+/i);
            if (!match) {
                await enviarMensagem("❌ Não foi possível identificar um placar válido (ex: 2x1) no comentário respondido.");
                return new Response("OK", { status: 200 });
            }

            const placarLimpo = match[0].toLowerCase().replace(/\s+/g, "");
            const nomeTorcedor = sanitizarNome(`${targetUser.first_name || ""} ${targetUser.last_name || ""}`);

            // Garante que o usuário existe na tabela de usuários
            await env.DB.prepare(`
                INSERT INTO usuarios (id, nome, pontos, criado_em)
                VALUES (?, ?, 0, ?)
                ON CONFLICT(id) DO UPDATE SET nome = excluded.nome
            `).bind(targetUser.id, nomeTorcedor, Date.now()).run();

            // Grava o palpite atrelado ao ID da postagem ativa
            await env.DB.prepare(`
                INSERT INTO palpites (postagem_id, user_id, palpite, mensagem_id, chat_id, reagido, criado_em)
                VALUES (?, ?, ?, ?, ?, 1, ?)
                ON CONFLICT(postagem_id, user_id) DO UPDATE SET 
                    palpite = excluded.palpite,
                    mensagem_id = excluded.mensagem_id,
                    chat_id = excluded.chat_id,
                    reagido = 1
            `).bind(postId, targetUser.id, placarLimpo, targetMsg.message_id, chatId, Date.now()).run();

            // Reage ao comentário do torcedor com 👍
            try {
                await fetch(`https://api.telegram.org/bot${botToken}/setMessageReaction`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        chat_id: chatId,
                        message_id: targetMsg.message_id,
                        reaction: [{ type: "emoji", emoji: "👍" }],
                        is_big: false
                    })
                });
            } catch (e) {
                console.error("Erro ao reagir no palpite:", e.message);
            }

            // Apaga a mensagem do comando /salvar
            try {
                await fetch(`https://api.telegram.org/bot${botToken}/deleteMessage`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ chat_id: chatId, message_id: mensagem.message_id })
                });
            } catch (e) {}

            return new Response("OK", { status: 200 });
        }
            
        // ==========================================================
        // 🔐 DEMAIS COMANDOS DE ADMINISTRAÇÃO E BOLÃO
        // ==========================================================
        else if (texto.startsWith("/iniciar_bolao")) {
            if (String(userId) !== "7717528550") return new Response("OK", { status: 200 });

            const params = texto.replace(/^\/iniciar_bolao\s*/, "").trim();
            let input = params.split("|");
            if (input.length < 2) {
                await enviarMensagem("❌ <b>Formato incorreto!</b> Use: <code>/iniciar_bolao Flamengo x Vasco 21h | ID_DA_FOTO</code>");
                return new Response("OK", { status: 200 });
            }

            const formatarTimes = (txt) => txt.toLowerCase().replace(/\b\w/g, (l) => l.toUpperCase());
            let infoJogo = formatarTimes(input[0].trim());
            let fotoId = input[1].trim();

            await deleteConfig(env.DB, "postagem_ativa_id");
            await setConfig(env.DB, "vencedores_temporarios", "");
            await deleteConfig(env.DB, "BOLAO_RESGATE_ID");

            let confrontoLimpo = infoJogo.replace(/\d{1,2}H\d{0,2}/gi, "").replace(/\d{1,2}:\d{2}/g, "").trim();
            let partesTimes = confrontoLimpo.split(/\s+x\s+/i);
            let timeCasa = partesTimes[0] ? partesTimes[0].trim() : "Time 1";
            let timeFora = partesTimes[1] ? partesTimes[1].trim() : "Time 2";

            let textoLegenda =
                "🏟 <b>BOLÃO DO MENGÃO</b> 🔴⚫\n\n" +
                "🔥 <b>PARTIDA:</b>\n<b>" + infoJogo + "</b>\n\n" +
                "💬 <b>COMO PARTICIPAR:</b>\nClique em <b>“Escrever um comentário”</b> e envie seu palpite.\n\n" +
                "<blockquote expandable>" +
                "📌 <b>LEIA ANTES DE PALPITAR</b>\n\n" +
                "O placar deve seguir exatamente a ordem da partida:\n<b>" + timeCasa + " X " + timeFora + "</b>\n\n" +
                "Exemplos:\n• <b>2x1</b>\n• <b>1x1</b>\n\n" +
                "⚠️ <b>REGRAS:</b> Apenas 1 palpite por usuário. Editou perde a validação. Palpites após o início não contam." +
                "</blockquote>\n\n" +
                "🏆 Vale <b>1 ponto</b> no ranking!";

            await setConfig(env.DB, "confronto_atual", infoJogo);
            await setConfig(env.DB, "bolao_aberto", "true");

            const respostaCanal = await fetch(`https://api.telegram.org/bot${botToken}/sendPhoto`, {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ chat_id: "@Flamengo77", photo: fotoId, caption: textoLegenda, parse_mode: "HTML" })
            });

            const dadosPostagem = await respostaCanal.json();
            if (dadosPostagem.ok && dadosPostagem.result?.message_id) {
                const canalMessageId = String(dadosPostagem.result.message_id);
                await setConfig(env.DB, "postagem_ativa_id", canalMessageId);
                await setConfig(env.DB, "confronto_" + canalMessageId, infoJogo);
                await env.DB.prepare(`
                    INSERT INTO boloes (postagem_id, confronto, criado_em)
                    VALUES (?, ?, ?)
                    ON CONFLICT(postagem_id) DO UPDATE SET confronto = excluded.confronto
                `).bind(canalMessageId, infoJogo, Date.now()).run();
                await enviarMensagem(`✅ <b>Bolão iniciado com sucesso!</b>\n\n📌 <b>ID do Post no Canal:</b> <code>${canalMessageId}</code>`);
            } else {
                let erroMsg = dadosPostagem.description || "Erro desconhecido ao enviar foto no canal.";
                await enviarMensagem(`❌ <b>Falha ao enviar postagem no canal @Flamengo77!</b>\n\n<code>${erroMsg}</code>`);
            }

            return new Response("OK", { status: 200 });
        }

        else if (texto.startsWith("/fechar_bolao")) {
            if (String(userId) !== "7717528550") return new Response("OK", { status: 200 });
            await setConfig(env.DB, "bolao_aberto", "false");
            await enviarMensagem("⛔ <b>Bolão fechado para novos palpites!</b>\n\n*(Aguardando encerramento da partida)*");
            return new Response("OK", { status: 200 });
        }

        // ==========================================================
        // 🥇 COMANDO /ganhou COM PRÉVIA E CONFIRMAÇÃO AUTOMÁTICA
        // ==========================================================
        else if (texto.startsWith("/ganhou")) {
            if (String(userId) !== "7717528550") return new Response("OK", { status: 200 });
            if (!update.message || !update.message.reply_to_message) {
                await enviarMensagem("❌ Responda ao palpite vencedor.");
                return new Response("OK", { status: 200 });
            }

            const replyTo = update.message.reply_to_message;
            const vencedor = replyTo.from;
            const msgIdComentario = replyTo.message_id;
            const chatIdComentario = update.message.chat.id;

            let postId = (await getConfig(env.DB, "postagem_ativa_id")) || (await getConfig(env.DB, "BOLAO_RESGATE_ID"));
            if (!postId) {
                await enviarMensagem("❌ Nenhum bolão ativo encontrado.");
                return new Response("OK", { status: 200 });
            }

            let realNameVencedor = sanitizarNome(`${vencedor.first_name || ""} ${vencedor.last_name || ""}`);
            let palpiteExibido = escHTML(replyTo.text || replyTo.caption || "Palpite do Jogo");
            let confronto = (await getConfig(env.DB, "confronto_" + postId)) || (await getConfig(env.DB, "confronto_atual")) || "FLAMENGO";

            let textoPrevia = 
                `🎯 <b>CONFIRMAR VENCEDOR DO BOLÃO?</b>\n\n` +
                `👤 <b>Torcedor:</b> <a href="tg://user?id=${vencedor.id}">${realNameVencedor}</a> (ID: <code>${vencedor.id}</code>)\n` +
                `🏟 <b>Confronto:</b> ${escHTML(confronto)}\n` +
                `📌 <b>Palpite:</b> <code>${palpiteExibido}</code>\n\n` +
                `<i>Confirme se deseja adicionar +1 ponto ao ranking e registrar a vitória.</i>`;

            let tecladoConfirmacao = [
                [
                    { text: "✅ Confirmar e Adicionar Ponto", callback_data: `confirm_ganhou_${vencedor.id}_${msgIdComentario}` },
                    { text: "❌ Cancelar", callback_data: "cancel_ganhou" }
                ]
            ];

            await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ chat_id: chatIdComentario, text: textoPrevia, parse_mode: "HTML", reply_to_message_id: msgIdComentario, reply_markup: { inline_keyboard: tecladoConfirmacao } })
            });

            return new Response("OK", { status: 200 });
        }

        // 🔘 PROCESSAMENTO DO BOTÃO DE CONFIRMAÇÃO DO /ganhou
        else if (texto.startsWith("confirm_ganhou_")) {
            if (String(userId) !== "7717528550") return new Response("OK", { status: 200 });
            await responderCallback("Gravando acerto no banco...");

            let partes = texto.replace("confirm_ganhou_", "").split("_");
            let targetUserId = Number(partes[0]);
            let msgIdComentario = partes[1];

            let postId = (await getConfig(env.DB, "postagem_ativa_id")) || (await getConfig(env.DB, "BOLAO_RESGATE_ID"));
            let confronto = (await getConfig(env.DB, "confronto_" + postId)) || (await getConfig(env.DB, "confronto_atual")) || "FLAMENGO";
            
            let userTargetInfo = await fetch(`https://api.telegram.org/bot${botToken}/getChatMember?chat_id=${chatId}&user_id=${targetUserId}`);
            let userData = await userTargetInfo.json();
            let realNameVencedor = sanitizarNome(`${userData.result?.user?.first_name || ""} ${userData.result?.user?.last_name || ""}`);
            
            let perfilLink = `<a href="tg://user?id=${targetUserId}">${realNameVencedor}</a>`;
            let linkPalpite = ` <a href="https://t.me/c/${String(chatId).replace('-100', '')}/${msgIdComentario}">(Ver Palpite)</a>`;
            let entradaGanhador = `🥇 ${perfilLink}${linkPalpite}`;

            // 1. Legenda Temporária
            let listaAtual = (await getConfig(env.DB, "vencedores_temporarios")) || "";
            let listaNova = listaAtual === "" ? entradaGanhador : listaAtual + "\n" + entradaGanhador;
            await setConfig(env.DB, "vencedores_temporarios", listaNova);

            // 2. IDs de Resgate
            let winnersRaw = await getConfig(env.DB, "vencedores_ids_" + postId);
            let listaIds = winnersRaw ? JSON.parse(winnersRaw) : [];
            if (!listaIds.includes(String(targetUserId))) listaIds.push(String(targetUserId));
            await setConfig(env.DB, "vencedores_ids_" + postId, JSON.stringify(listaIds));

            // 3. Atualiza Pontos e Registra Acerto no D1
            await env.DB.prepare(`
                INSERT INTO usuarios (id, nome, pontos, criado_em) 
                VALUES (?, ?, 1, ?)
                ON CONFLICT(id) DO UPDATE SET pontos = pontos + 1, nome = ?
            `).bind(targetUserId, realNameVencedor, Date.now(), realNameVencedor).run();

            if (postId) {
                await env.DB.prepare(`
                    INSERT INTO acertos (postagem_id, user_id, confronto, placar, resgatado, resgatado_em)
                    VALUES (?, ?, ?, 'Acerto Confirmado', 1, ?)
                    ON CONFLICT(postagem_id, user_id) DO UPDATE SET resgatado = 1, resgatado_em = excluded.resgatado_em
                `).bind(postId, targetUserId, confronto, Date.now()).run();
            }

            await editarMensagem(`🎯 <b>ACERTO CONFIRMADO!</b>\n\nParabéns ${perfilLink} 🏆\n➕ 1 ponto adicionado ao ranking e acertos registrados!`);
            return new Response("OK", { status: 200 });
        }

        else if (texto === "cancel_ganhou") {
            if (String(userId) !== "7717528550") return new Response("OK", { status: 200 });
            await responderCallback("Ação cancelada.");
            await editarMensagem("❌ <b>Registro de vencedor cancelado.</b> Nenhuma alteração foi feita.");
            return new Response("OK", { status: 200 });
        }

        // ==========================================================
        // 🏁 COMANDO /encerrar_bolao (APURAÇÃO INSTANTÂNEA NO D1)
        // ==========================================================
        else if (texto.startsWith("/encerrar_bolao")) {
            if (String(userId) !== "7717528550") return new Response("OK", { status: 200 });

            let input = texto.replace("/encerrar_bolao", "").split("|");
            let placar = input[0]?.trim();
            let fotoResultadoId = input[1]?.trim();

            let msgIdOriginal = await getConfig(env.DB, "postagem_ativa_id");
            if (!msgIdOriginal) {
                await enviarMensagem("❌ Nenhum bolão ativo encontrado para encerrar.");
                return new Response("OK", { status: 200 });
            }

            let confronto = (await getConfig(env.DB, "confronto_" + msgIdOriginal)) || (await getConfig(env.DB, "confronto_atual")) || "FLAMENGO";

            // 1. APURAÇÃO DIRETA VIA QUERY SQL NO D1
            const { results: vencedores } = await env.DB.prepare(`
                SELECT user_id FROM palpites 
                WHERE postagem_id = ? AND LOWER(TRIM(palpite)) = LOWER(TRIM(?))
            `).bind(msgIdOriginal, placar).all();

            const vencedoresIds = vencedores.map(v => String(v.user_id));

            if (vencedoresIds.length > 0) {
                const placeholders = vencedoresIds.map(() => "?").join(",");
                await env.DB.prepare(`
                    UPDATE usuarios 
                    SET pontos = pontos + 1 
                    WHERE id IN (${placeholders})
                `).bind(...vencedoresIds).run();

                for (const vId of vencedoresIds) {
                    await env.DB.prepare(`
                        INSERT INTO acertos (postagem_id, user_id, confronto, placar, resgatado, resgatado_em)
                        VALUES (?, ?, ?, ?, 1, ?)
                        ON CONFLICT(postagem_id, user_id) DO UPDATE SET resgatado = 1, resgatado_em = excluded.resgatado_em
                    `).bind(msgIdOriginal, Number(vId), confronto, placar, Date.now()).run();
                }
            }

            await setConfig(env.DB, "vencedores_ids_" + msgIdOriginal, JSON.stringify(vencedoresIds));
            let vencedoresFinal = (await getConfig(env.DB, "vencedores_temporarios")) || (vencedoresIds.length > 0 ? `🎉 ${vencedoresIds.length} torcedor(es) acertaram o placar!` : "Nenhum vencedor registrado.");

            // 2. GRAVA RESULTADOS E FECHA PALPITES
            await setConfig(env.DB, "resultado_oficial_" + msgIdOriginal, placar);
            await setConfig(env.DB, "bolao_encerrado_em_" + msgIdOriginal, String(Date.now()));
            await setConfig(env.DB, "bolao_aberto", "false");

            await env.DB.prepare(`
                INSERT INTO boloes (postagem_id, confronto, criado_em)
                VALUES (?, ?, ?)
                ON CONFLICT(postagem_id) DO UPDATE SET confronto = excluded.confronto
            `).bind(msgIdOriginal, confronto, Date.now()).run();

            // 3. PUBLICA NO CANAL
            let legendaResultado = `🏆 <b>RESULTADO DO BOLÃO</b> 🏆\n\n⚽ Jogo: <b>${escHTML(confronto)}</b>\n📊 Resultado: <b>${escHTML(placar)}</b>\n\n🥇 Ganhador(es):\n${vencedoresFinal}\n\n🎁 Resgate seu ponto no botão abaixo!`;
            let tecladoResgate = [[{ text: "🥇 RESGATAR MEU PONTO", url: "https://t.me/FlamengoGolsBot?start=resgatar_" + msgIdOriginal }]];

            if (fotoResultadoId) {
                await fetch(`https://api.telegram.org/bot${botToken}/sendPhoto`, {
                    method: "POST", headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ chat_id: "@Flamengo77", photo: fotoResultadoId, caption: legendaResultado, reply_to_message_id: Number(msgIdOriginal), parse_mode: "HTML", reply_markup: { inline_keyboard: tecladoResgate } })
                });
            } else {
                await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                    method: "POST", headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ chat_id: "@Flamengo77", text: legendaResultado, reply_to_message_id: Number(msgIdOriginal), parse_mode: "HTML", disable_web_page_preview: true, reply_markup: { inline_keyboard: tecladoResgate } })
                });
            }

            await setConfig(env.DB, "vencedores_temporarios", "");
            await deleteConfig(env.DB, "postagem_ativa_id");

            await enviarMensagem("✅ <b>Bolão encerrado, apuração executada e ranking atualizado no D1!</b>");
            return new Response("OK", { status: 200 });
        }

        else if (texto === "/ranking") {
            if (isCallback) await responderCallback();

            const { results: rankingArray } = await env.DB.prepare(`
                SELECT nome, pontos FROM usuarios 
                WHERE pontos > 0 
                ORDER BY pontos DESC 
                LIMIT 15
            `).all();

            let mensagemRanking = "🏆 <b>RANKING DO BOLÃO</b> 🏆\n\n";
            if (rankingArray.length === 0) {
                mensagemRanking += "<i>Nenhum torcedor pontuou ainda. Participe dos bolões no @Flamengo77!</i>\n";
            } else {
                for (let i = 0; i < rankingArray.length; i++) {
                    let pos = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : "👤";
                    mensagemRanking += `${pos} ${rankingArray[i].nome} — <b>${rankingArray[i].pontos} pts</b>\n`;
                }
            }

            const tecladoRanking = [[{ text: "🔄 Atualizar", callback_data: "/ranking" }]];

            if (isCallback) await editarMensagem(mensagemRanking, tecladoRanking);
            else await enviarMensagem(mensagemRanking, tecladoRanking);
            return new Response("OK", { status: 200 });
        }

        else if (texto.startsWith("/addgoal")) {
            if (String(userId) !== "7717528550") return new Response("OK", { status: 200 });
            const tecladoWebApp = [
                [{ text: "🏆 Gestor do Bolão WebApp", web_app: { url: "https://lucky-bar-5077.futvert.workers.dev/api/painel-bolao" } }],
                [{ text: "➕ Adicionar / Editar Gol", web_app: { url: "https://lucky-bar-5077.futvert.workers.dev/api/painel-addgoal" } }],
                [{ text: "📋 Ver / Buscar na Lista Completa", web_app: { url: "https://lucky-bar-5077.futvert.workers.dev/api/lista-gols" } }]
            ];
            await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: chatId, text: "⚙️ <b>PAINEL DE CONTROLE FLAMENGO GOLS</b>", parse_mode: "HTML", reply_markup: { inline_keyboard: tecladoWebApp } }) });
            return new Response("OK", { status: 200 });
        }

        else if (texto.startsWith("/getid")) {
            if (String(userId) !== "7717528550") return new Response("OK", { status: 200 });
            if (!update.message?.reply_to_message) return new Response("OK", { status: 200 });

            const msgReply = update.message.reply_to_message;
            let fileId = msgReply.photo ? msgReply.photo[msgReply.photo.length - 1].file_id : msgReply.video?.file_id || msgReply.document?.file_id || msgReply.animation?.file_id || "";
            
            await enviarMensagem(`🆔 <b>FileID:</b>\n<code>${fileId}</code>`);
            return new Response("OK", { status: 200 });
        }

        // ==========================================================
        // 📸 COMANDO ADMIN: ATUALIZAR FOTOS EM PAGINAÇÃO INTERATIVA (5 EM 5)
        // ==========================================================
        else if (texto === "/atualizar_fotos") {
            if (String(userId) !== "7717528550") return new Response("OK", { status: 200 });

            await processarLoteFotos(0, chatId, env, botToken, false);
            return new Response("OK", { status: 200 });
        }

        else if (texto.startsWith("fotos_page_")) {
            if (String(userId) !== "7717528550") return new Response("OK", { status: 200 });
            await responderCallback("Processando lote...");

            let offset = parseInt(texto.replace("fotos_page_", "")) || 0;
            await processarLoteFotos(offset, chatId, env, botToken, true, mensagem.message_id);
            return new Response("OK", { status: 200 });
        }

        // ==========================================================
        // ⚽ CAPTURA AUTOMÁTICA DE PALPITES VINCULADOS AO BOLÃO DO CANAL
        // ==========================================================
        else if (texto) {
            const regexPlacar = /\d+\s*(x|X|×|-|a)\s*\d+/i;

            if (regexPlacar.test(texto)) {
                let bolaoAberto = await getConfig(env.DB, "bolao_aberto");

                if (bolaoAberto === "true") {
                    let postId = await getConfig(env.DB, "postagem_ativa_id");

                    if (postId) {
                        const replyTo = mensagem.reply_to_message;
                        const threadId = mensagem.message_thread_id;

                        // Se o post no canal gerou um post espelho no grupo, ele vincula automaticamente
                        let postGrupoId = await getConfig(env.DB, "post_grupo_id_" + postId);

                        // Se a mensagem que está sendo respondida é um encaminhamento automático do canal com o ID do bolão
                        const eEncaminhamentoDoBolao = replyTo && (
                            String(replyTo.forward_from_message_id) === String(postId) ||
                            (replyTo.forward_origin && String(replyTo.forward_origin.message_id) === String(postId))
                        );

                        // Se a resposta está dentro do ID do post que chegou no grupo
                        if (eEncaminhamentoDoBolao && replyTo.message_id && !postGrupoId) {
                            postGrupoId = String(replyTo.message_id);
                            await setConfig(env.DB, "post_grupo_id_" + postId, postGrupoId);
                        }

                        // Validação estrita: responde ao post do canal, ao post do grupo ou à thread correspondente
                        const eComentarioDoBolao = Boolean(
                            eEncaminhamentoDoBolao ||
                            (postGrupoId && replyTo && String(replyTo.message_id) === String(postGrupoId)) ||
                            (postGrupoId && threadId && String(threadId) === String(postGrupoId)) ||
                            (replyTo && String(replyTo.message_id) === String(postId))
                        );

                        if (eComentarioDoBolao) {
                            const match = texto.match(/\d+\s*(?:x|X|×|-|a)\s*\d+/i);
                            const placarLimpo = match ? match[0].toLowerCase().replace(/\s+/g, "") : texto.trim();

                            let reagiuOk = 0;
                            try {
                                const reactRes = await fetch(`https://api.telegram.org/bot${botToken}/setMessageReaction`, {
                                    method: "POST",
                                    headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify({
                                        chat_id: chatId,
                                        message_id: mensagem.message_id,
                                        reaction: [{ type: "emoji", emoji: "👍" }],
                                        is_big: false
                                    })
                                });
                                const reactJson = await reactRes.json();
                                if (reactJson.ok) reagiuOk = 1;
                            } catch (e) {
                                console.error("Erro ao reagir:", e.message);
                            }

                            // Grava no D1 vinculado ao bolão
                            await env.DB.prepare(`
                                INSERT INTO palpites (postagem_id, user_id, palpite, mensagem_id, chat_id, reagido, criado_em)
                                VALUES (?, ?, ?, ?, ?, ?, ?)
                                ON CONFLICT(postagem_id, user_id) DO UPDATE SET 
                                    palpite = excluded.palpite,
                                    mensagem_id = excluded.mensagem_id,
                                    chat_id = excluded.chat_id,
                                    reagido = excluded.reagido
                            `).bind(postId, userId, placarLimpo, mensagem.message_id, chatId, reagiuOk, Date.now()).run();
                        }
                    }
                }
            }
        }

        return new Response("OK", { status: 200 });

    } catch (erro) {
        console.error("ERRO GRAVE INTERNO:", erro.message);
        return new Response("OK", { status: 200 });
    }
}
