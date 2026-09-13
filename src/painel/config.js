export async function getConfig(db, chave) {
  const row = await db.prepare("SELECT valor FROM config WHERE chave = ?").bind(chave).first();
  return row ? row.valor : null;
}

export async function setConfig(db, chave, valor) {
  await db.prepare("INSERT OR REPLACE INTO config (chave, valor) VALUES (?, ?)").bind(chave, String(valor)).run();
}

export async function deleteConfig(db, chave) {
  await db.prepare("DELETE FROM config WHERE chave = ?").bind(chave).run();
}

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS, DELETE",
      "Access-Control-Allow-Headers": "Content-Type"
    }
  });
}
