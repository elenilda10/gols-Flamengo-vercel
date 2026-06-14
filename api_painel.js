export async function processarRotaApi(request, env) {
    const url = new URL(request.url);

    // Rota de Migração do Acervo TBL -> Cloudflare KV
    if (url.pathname === "/api/importar-tudo" && request.method === "POST") {
        try {
            const acervo = await request.json();
            let novosIds = [];

            for (const gol of acervo) {
                if (gol && gol.id) {
                    await env.GOLS_FLAMENGO_KV.put(`gol_${gol.id}`, JSON.stringify(gol));
                    novosIds.push(String(gol.id));
                }
            }

            // Salva o índice com a lista de todos os IDs de gols
            await env.GOLS_FLAMENGO_KV.put("gols_index", JSON.stringify(novosIds));

            return new Response(JSON.stringify({ status: "sucesso", gols_importados: acervo.length }), {
                status: 200, headers: { "Content-Type": "application/json" }
            });
        } catch (erro) {
            return new Response(JSON.stringify({ status: "erro", detalhe: erro.message }), {
                status: 500, headers: { "Content-Type": "application/json" }
            });
        }
    }

    return new Response(JSON.stringify({ erro: "Rota não encontrada" }), { status: 404 });
}
