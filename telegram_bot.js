// ==========================================================
// 📥 FLUXO PRINCIPAL DO TELEGRAM
// ==========================================================
export async function processarMensagemTelegram(request, env, botTokenPassado) {
    const botToken = botTokenPassado || env.TELEGRAM_TOKEN; 

    try {
        const update = await request.json();

        // ==========================================================
        // ⚡ MODO INLINE QUERY (Busca de Gols)
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
            return str.replace(/[\u0000-\u001F\u007F-\u009F\uFFFD]/g, "").trim() || "Torcedor";
        };

        const realName = sanitizarNome(`${userFirstName} ${userLastName}`);
        const escHTML = (text) => String(text || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        const mention = `<a href="tg://user?id=${userId}">${escHTML(realName)}</a>`;

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

        let savedLang = await env.GOLS_FLAMENGO_KV.get(`lang_${userId}`);
        let userLangCode = savedLang || (update.callback_query ? update.callback_query.from.language_code : update.message.from.language_code) || "pt";
        userLangCode = userLangCode.substring(0, 2).toLowerCase();
        let lang = ["pt", "en", "es"].includes(userLangCode) ? userLangCode : "pt";

        let userExiste = await env.GOLS_FLAMENGO_KV.get(`user_${userId}`);
        if (!userExiste) {
            await env.GOLS_FLAMENGO_KV.put(`user_${userId}`, "true");
            let totalAtual = await env.GOLS_FLAMENGO_KV.get("TOTAL_USERS") || 0;
            await env.GOLS_FLAMENGO_KV.put("TOTAL_USERS", String(Number(totalAtual) + 1));
        }
        let totalUsers = await env.GOLS_FLAMENGO_KV.get("TOTAL_USERS") || 1;

        if (texto.startsWith("set_lang_")) {
            lang = texto.replace("set_lang_", "");
            await env.GOLS_FLAMENGO_KV.put(`lang_${userId}`, lang);
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

            // 🎯 PROCESSAMENTO DO DEEP LINK DE RESGATE (/start resgatar_ID)
            if (texto.startsWith("/start resgatar_")) {
                let params = texto.replace("/start", "").trim();
                let postagemId = params.replace("resgatar_", "").trim();
                
                let confronto = await env.GOLS_FLAMENGO_KV.get("confronto_" + postagemId) || await env.GOLS_FLAMENGO_KV.get("confronto_atual") || "Partida não informada";
                let resultadoOficial = await env.GOLS_FLAMENGO_KV.get("resultado_oficial_" + postagemId) || "Resultado ainda não informado";
                let encerradoEm = await env.GOLS_FLAMENGO_KV.get("bolao_encerrado_em_" + postagemId) || 0;
                
                let umaHora = 60 * 60 * 1000;
                let aindaEmRevisao = Date.now() - Number(encerradoEm) < umaHora;

                let meuPalpiteRaw = await env.GOLS_FLAMENGO_KV.get("palpite_user_" + postagemId + "_" + userId);
                let textoPalpite = "";
                if (meuPalpiteRaw) {
                    let meuPalpite = JSON.parse(meuPalpiteRaw);
                    if (meuPalpite.palpite) textoPalpite = "\n📌 Seu palpite: <b>" + escHTML(meuPalpite.palpite) + "</b>";
                }

                let winnersRaw = await env.GOLS_FLAMENGO_KV.get("vencedores_ids_" + postagemId);
                let vencedoresIds = winnersRaw ? JSON.parse(winnersRaw) : [];
                let ganhou = vencedoresIds.includes(String(userId));

                let chaveResgateConcluido = "resgate_concluido_" + postagemId + "_" + userId;
                let jaResgatou = await env.GOLS_FLAMENGO_KV.get(chaveResgateConcluido);

                if (jaResgatou === "true") {
                    await enviarMensagem("✅ " + mention + ", você já resgatou este ponto do Flamengo.\n\n🏟 <b>Bolão:</b> " + escHTML(confronto) + "\n⚽ <b>Resultado:</b> " + escHTML(resultadoOficial) + textoPalpite);
                    return new Response("OK", { status: 200 });
                }

                if (ganhou) {
                    await env.GOLS_FLAMENGO_KV.put(chaveResgateConcluido, "true");
                    let chaveAcertosTotal = "acertos_total_" + userId;
                    let acertos = Number(await env.GOLS_FLAMENGO_KV.get(chaveAcertosTotal) || 0) + 1;
                    await env.GOLS_FLAMENGO_KV.put(chaveAcertosTotal, String(acertos));
                    
                    let jaVerificou = await env.GOLS_FLAMENGO_KV.get("resgate_verificado_" + postagemId + "_" + userId);
                    let textoExtra = jaVerificou === "true" ? "\n🛠 Seu acerto foi reconhecido após a conferência manual." : "";
                    
                    await enviarMensagem("🎯 " + mention + ", seu acerto foi reconhecido! ❤️🖤\n\n🏆 <b>Bolão:</b> " + escHTML(confronto) + "\n⚽ <b>Resultado:</b> " + escHTML(resultadoOficial) + textoPalpite + "\n\n✅ Status: <b>Você ganhou!</b>" + textoExtra + "\n\n➕ Ponto adicionado!\n📊 Total de acertos: <b>" + acertos + "</b>");
                    return new Response("OK", { status: 200 });
                }

                await env.GOLS_FLAMENGO_KV.put("resgate_verificado_" + postagemId + "_" + userId, "true");
                let textoRevisao = aindaEmRevisao ? "\n\n🕒 O resultado ainda está no período de revisão de 1 hora." : "";
                await enviarMensagem("😔 " + mention + ", você não faturou este bolão.\n\n🏟 <b>Bolão:</b> " + escHTML(confronto) + "\n⚽ <b>Resultado:</b> " + escHTML(resultadoOficial) + textoPalpite + "\n\n❌ Status: <b>Você perdeu.</b>" + textoRevisao);
                return new Response("OK", { status: 200 });
            }

            const textosMenu = {
                pt: "👋 Olá " + realName + ", seja muito bem-vindo(a) ao @FlamengoGolsBot! 🔴⚫\n\nAqui você encontra todos os gols dos campeonatos que o Mengão disputa.\n\n✍️ Como usar:\nDigite em qualquer chat:\n@FlamengoGolsBot Flamengo\n\n☝️ Mais comandos: /ajuda\n\n▶️ Usuários ativos: " + totalUsers,
                en: "👋 Hello " + realName + ", welcome to @FlamengoGolsBot! 🔴⚫\n\nHere you will find goals from all the championships Flamengo plays in.\n\n✍️ How to use:\nType in any chat:\n@FlamengoGolsBot Flamengo\n\n☝️ More commands: /help\n\n▶️ Active users: " + totalUsers,
                es: "👋 ¡Hola " + realName + ", bienvenido al @FlamengoGolsBot! 🔴⚫\n\nAquí encontrarás todos los goles de los campeonatos que disputa el Flamengo.\n\n✍️ Cómo usar:\nEscribe en qualquer chat:\n@FlamengoGolsBot Flamengo\n\n☝️ Más comandos: /ayuda\n\n▶️ Usuarios activos: " + totalUsers
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
        }

        else if (texto === "/ajuda" || texto === "/help" || texto === "/ayuda") {
            const textosAjuda = {
                pt: "🆘 <b>Central de Ajuda - Flamengo Gols Bot</b>\n\nBem-vindo ao bot oficial de gols do Flamengo! 🔴⚫\n\n🚀 <b>Como usar no modo inline</b>\nVocê pode buscar gols direto em qualquer chat, grupo ou conversa, sem precisar abrir o bot.\n\n<b>Passo a passo:</b>\n1️⃣ Vá para qualquer grupo\n2️⃣ Digite: <code>@FlamengoGolsBot Flamengo</code>\n3️⃣ Escolha o resultado e envie! 🎥🔥",
                en: "🆘 <b>Help Center - Flamengo Goals Bot</b>\n\nWelcome to the official Flamengo goals bot! 🔴⚫\n\n🚀 <b>How to use inline mode</b>\nSearch goals directly in any chat without opening the bot.\n\n<b>Step by step:</b>\n1️⃣ Go to any group\n2️⃣ Type: <code>@FlamengoGolsBot Flamengo</code>\n3️⃣ Choose the result and send! 🎥🔥",
                es: "🆘 <b>Centro de Ayuda - Flamengo Goles Bot</b>\n\n¡Bienvenido al bot oficial de gols del Flamengo! 🔴⚫\n\n🚀 <b>Cómo usar el modo inline</b>\nBusca goles directamente en qualquer chat sin abrir el bot.\n\n<b>Paso a passo:</b>\n1️⃣ Ve a cualquier grupo\n2️⃣ Escribe: <code>@FlamengoGolsBot Flamengo</code>\n3️⃣ ¡Elige el resultado y envía! 🎥🔥"
            };
            const tecladoAjuda = [[{ text: lang === "pt" ? "🔙 Voltar" : lang === "en" ? "🔙 Back" : "🔙 Volver", callback_data: "menu_principal" }]];
            await enviarMensagem(textosAjuda[lang], tecladoAjuda);
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

            await env.GOLS_FLAMENGO_KV.delete("postagem_ativa_id");
            await env.GOLS_FLAMENGO_KV.put("vencedores_temporarios", "");
            await env.GOLS_FLAMENGO_KV.delete("BOLAO_RESGATE_ID");

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

            await env.GOLS_FLAMENGO_KV.put("confronto_atual", infoJogo);
            await env.GOLS_FLAMENGO_KV.put("bolao_aberto", "true");

            const respostaCanal = await fetch(`https://api.telegram.org/bot${botToken}/sendPhoto`, {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ chat_id: "@Flamengo77", photo: fotoId, caption: textoLegenda, parse_mode: "HTML" })
            });

            const dadosPostagem = await respostaCanal.json();
            if (dadosPostagem.ok && dadosPostagem.result?.message_id) {
                const canalMessageId = String(dadosPostagem.result.message_id);
                await env.GOLS_FLAMENGO_KV.put("postagem_ativa_id", canalMessageId);
                await env.GOLS_FLAMENGO_KV.put("confronto_" + canalMessageId, infoJogo);
                await enviarMensagem(`✅ <b>Bolão iniciado com sucesso!</b>\n\n📌 <b>ID do Post no Canal:</b> <code>${canalMessageId}</code>`);
            } else {
                let erroMsg = dadosPostagem.description || "Erro desconhecido ao enviar foto no canal.";
                await enviarMensagem(`❌ <b>Falha ao enviar postagem no canal @Flamengo77!</b>\n\n<code>${erroMsg}</code>`);
            }

            return new Response("OK", { status: 200 });
        }

        else if (texto.startsWith("/fechar_bolao")) {
            if (String(userId) !== "7717528550") return new Response("OK", { status: 200 });
            await env.GOLS_FLAMENGO_KV.put("bolao_aberto", "false");
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

            let postId = await env.GOLS_FLAMENGO_KV.get("postagem_ativa_id") || await env.GOLS_FLAMENGO_KV.get("BOLAO_RESGATE_ID");
            if (!postId) {
                await enviarMensagem("❌ Nenhum bolão ativo encontrado.");
                return new Response("OK", { status: 200 });
            }

            let realNameVencedor = sanitizarNome(`${vencedor.first_name || ""} ${vencedor.last_name || ""}`);
            let palpiteExibido = escHTML(replyTo.text || replyTo.caption || "Palpite do Jogo");
            let confronto = await env.GOLS_FLAMENGO_KV.get("confronto_" + postId) || await env.GOLS_FLAMENGO_KV.get("confronto_atual") || "FLAMENGO";

            let textoPrevia = 
                `🎯 <b>CONFIRMAR VENCEDOR DO BOLÃO?</b>\n\n` +
                `👤 <b>Torcedor:</b> <a href="tg://user?id=${vencedor.id}">${escHTML(realNameVencedor)}</a> (ID: <code>${vencedor.id}</code>)\n` +
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

        // 🔘 PROCESSAMENTO DA RESPOSTA DOS BOTÕES DE CONFIRMAÇÃO DO /ganhou
        else if (texto.startsWith("confirm_ganhou_")) {
            if (String(userId) !== "7717528550") return new Response("OK", { status: 200 });
            await responderCallback("Gravando acerto no banco...");

            let partes = texto.replace("confirm_ganhou_", "").split("_");
            let targetUserId = partes[0];
            let msgIdComentario = partes[1];

            let postId = await env.GOLS_FLAMENGO_KV.get("postagem_ativa_id") || await env.GOLS_FLAMENGO_KV.get("BOLAO_RESGATE_ID");
            
            let userTargetInfo = await fetch(`https://api.telegram.org/bot${botToken}/getChatMember?chat_id=${chatId}&user_id=${targetUserId}`);
            let userData = await userTargetInfo.json();
            let realNameVencedor = sanitizarNome(`${userData.result?.user?.first_name || ""} ${userData.result?.user?.last_name || ""}`);
            
            let perfilLink = `<a href="tg://user?id=${targetUserId}">${escHTML(realNameVencedor)}</a>`;
            let linkPalpite = ` <a href="https://t.me/c/${String(chatId).replace('-100', '')}/${msgIdComentario}">(Ver Palpite)</a>`;
            let entradaGanhador = `🥇 ${perfilLink}${linkPalpite}`;

            // 1. Legenda Temporária
            let listaAtual = await env.GOLS_FLAMENGO_KV.get("vencedores_temporarios") || "";
            let listaNova = listaAtual === "" ? entradaGanhador : listaAtual + "\n" + entradaGanhador;
            await env.GOLS_FLAMENGO_KV.put("vencedores_temporarios", listaNova);

            // 2. IDs de Resgate
            let winnersRaw = await env.GOLS_FLAMENGO_KV.get("vencedores_ids_" + postId);
            let listaIds = winnersRaw ? JSON.parse(winnersRaw) : [];
            if (!listaIds.includes(String(targetUserId))) listaIds.push(String(targetUserId));
            await env.GOLS_FLAMENGO_KV.put("vencedores_ids_" + postId, JSON.stringify(listaIds));

            // 3. Ranking e Nomes
            let rankingRaw = await env.GOLS_FLAMENGO_KV.get("ranking_global");
            let ranking = rankingRaw ? JSON.parse(rankingRaw) : {};
            ranking[targetUserId] = (Number(ranking[targetUserId]) || 0) + 1;
            await env.GOLS_FLAMENGO_KV.put("ranking_global", JSON.stringify(ranking));

            let namesRaw = await env.GOLS_FLAMENGO_KV.get("ranking_names");
            let names = namesRaw ? JSON.parse(namesRaw) : {};
            names[targetUserId] = realNameVencedor;
            await env.GOLS_FLAMENGO_KV.put("ranking_names", JSON.stringify(names));

            // 4. Acertos do Usuário
            let confronto = await env.GOLS_FLAMENGO_KV.get("confronto_" + postId) || await env.GOLS_FLAMENGO_KV.get("confronto_atual") || "FLAMENGO";
            let acertosRaw = await env.GOLS_FLAMENGO_KV.get("acertos_" + targetUserId);
            let acertosLista = [];
            if (acertosRaw) {
                try {
                    acertosLista = JSON.parse(acertosRaw);
                    if (typeof acertosLista === "string") acertosLista = [acertosLista];
                    if (!Array.isArray(acertosLista)) acertosLista = [];
                } catch (e) { acertosLista = []; }
            }

            if (!acertosLista.includes(confronto)) {
                acertosLista.push(confronto);
                await env.GOLS_FLAMENGO_KV.put("acertos_" + targetUserId, JSON.stringify(acertosLista));
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

        else if (texto.startsWith("/encerrar_bolao")) {
            if (String(userId) !== "7717528550") return new Response("OK", { status: 200 });

            let input = texto.replace("/encerrar_bolao", "").split("|");
            let placar = input[0]?.trim();
            let fotoResultadoId = input[1]?.trim();

            let msgIdOriginal = await env.GOLS_FLAMENGO_KV.get("postagem_ativa_id");
            if (!msgIdOriginal) {
                await enviarMensagem("❌ Nenhum bolão ativo encontrado para encerrar.");
                return new Response("OK", { status: 200 });
            }

            let confronto = await env.GOLS_FLAMENGO_KV.get("confronto_atual") || "Jogo";
            let vencedoresFinal = await env.GOLS_FLAMENGO_KV.get("vencedores_temporarios") || "Nenhum vencedor registrado.";

            // 1. APURAÇÃO AUTOMÁTICA DO RANKING GLOBAL (Sincronização com Vercel/Site)
            try {
                const urlWorker = new URL(request.url);
                const apuracaoUrl = `${urlWorker.origin}/api/apurar-bolao`;

                await fetch(apuracaoUrl, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        admin_id: "7717528550",
                        post_id: msgIdOriginal,
                        placar_real: placar
                    })
                });
            } catch (errApi) {
                console.error("Erro ao integrar com a API de apuração:", errApi.message);
            }

            // 2. Grava os dados do encerramento
            await env.GOLS_FLAMENGO_KV.put("resultado_oficial_" + msgIdOriginal, placar);
            await env.GOLS_FLAMENGO_KV.put("bolao_encerrado_em_" + msgIdOriginal, String(Date.now()));
            await env.GOLS_FLAMENGO_KV.put("bolao_aberto", "false");

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

            await env.GOLS_FLAMENGO_KV.put("vencedores_temporarios", "");
            await env.GOLS_FLAMENGO_KV.delete("postagem_ativa_id");

            await enviarMensagem("✅ <b>Bolão encerrado e pontos contabilizados no ranking com sucesso!</b>");
            return new Response("OK", { status: 200 });
        }

        else if (texto === "/ranking") {
            if (isCallback) await responderCallback();

            let rankingRaw = await env.GOLS_FLAMENGO_KV.get("ranking_global");
            let namesRaw = await env.GOLS_FLAMENGO_KV.get("ranking_names");

            let ranking = rankingRaw ? JSON.parse(rankingRaw) : {};
            let nomes = namesRaw ? JSON.parse(namesRaw) : {};

            let rankingArray = Object.keys(ranking).map(id => ({ id: id, nome: nomes[id] || "Torcedor", pontos: Number(ranking[id]) || 0 }));
            rankingArray.sort((a, b) => b.pontos - a.pontos);

            let mensagemRanking = "🏆 <b>RANKING DO BOLÃO</b> 🏆\n\n";
            for (let i = 0; i < rankingArray.length; i++) {
                let pos = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : "👤";
                mensagemRanking += `${pos} ${rankingArray[i].nome} — <b>${rankingArray[i].pontos} pts</b>\n`;
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
        // ⚽ CAPTURAR PALPITES APENAS NOS COMENTÁRIOS DO BOLÃO E REAGIR COM 👍
        // ==========================================================
        else if (texto) {
            const regexPlacar = /\d+\s*(x|X|×|-|a)\s*\d+/i;

            if (regexPlacar.test(texto)) {
                let bolaoAberto = await env.GOLS_FLAMENGO_KV.get("bolao_aberto");

                if (bolaoAberto === "true") {
                    let postId = await env.GOLS_FLAMENGO_KV.get("postagem_ativa_id");

                    if (postId) {
                        const replyTo = mensagem.reply_to_message;

                        const eComentarioDoBolao = replyTo && (
                            String(replyTo.message_id) === String(postId) ||
                            String(replyTo.forward_from_message_id) === String(postId)
                        );

                        if (eComentarioDoBolao) {
                            await env.GOLS_FLAMENGO_KV.put(
                                "palpite_user_" + postId + "_" + userId,
                                JSON.stringify({ palpite: texto.trim(), nome: realName, hora: Date.now() })
                            );

                            try {
                                await fetch(`https://api.telegram.org/bot${botToken}/setMessageReaction`, {
                                    method: "POST",
                                    headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify({
                                        chat_id: chatId,
                                        message_id: mensagem.message_id,
                                        reaction: [{ type: "emoji", emoji: "👍" }],
                                        is_big: false
                                    })
                                });
                            } catch (e) {}
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
