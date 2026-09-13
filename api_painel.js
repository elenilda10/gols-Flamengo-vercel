import { processarMigrationApi } from "./src/painel/migrationApi.js";
import { processarRankingApi } from "./src/painel/rankingApi.js";
import { processarUsersApi } from "./src/painel/usersApi.js";

export async function processarRotaApi(request, env) {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS, DELETE",
        "Access-Control-Allow-Headers": "Content-Type"
      }
    });
  }

  const migrationResponse = await processarMigrationApi(request, env);
  if (migrationResponse) return migrationResponse;

  const rankingResponse = await processarRankingApi(request, env);
  if (rankingResponse) return rankingResponse;

  const usersResponse = await processarUsersApi(request, env);
  if (usersResponse) return usersResponse;

  return new Response(JSON.stringify({ erro: "Rota não encontrada" }), {
    status: 404,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*"
    }
  });
}
