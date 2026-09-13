export async function processarBolaoTestPages(request) {
  const url = new URL(request.url);
  if (url.pathname !== "/api/teste/painel-bolao" || request.method !== "GET") return null;

  const html = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>🧪 Bolão de Teste</title>
<style>
body{margin:0;background:#0b0d10;color:#f8fafc;font-family:system-ui,-apple-system,sans-serif;padding:20px}
.card{max-width:680px;margin:auto;background:#151922;border:1px solid #ffffff18;border-radius:20px;padding:24px;box-sizing:border-box}
h1{margin:0 0 8px;font-size:26px}.muted{color:#94a3b8}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:18px 0}.stat{background:#0f131a;border:1px solid #ffffff12;border-radius:14px;padding:14px}.num{font-size:26px;font-weight:800}.btn{border:0;border-radius:12px;padding:13px 16px;font-weight:800;cursor:pointer;color:#fff;margin:4px}.green{background:#15803d}.red{background:#b91c1c}.blue{background:#1d4ed8}.orange{background:#c2410c}code{color:#fca5a5}.box{background:#0f131a;border:1px solid #ffffff12;border-radius:14px;padding:16px;margin:14px 0;line-height:1.6}@media(max-width:600px){.grid{grid-template-columns:1fr}.btn{width:100%;margin:5px 0}}
</style>
</head>
<body>
<div class="card">
<h1>🧪 Ambiente de Teste do Bolão</h1>
<p class="muted">Isolado do ranking e dos palpites reais.</p>
<div id="status" class="box">Carregando...</div>
<div class="grid">
  <div class="stat"><div class="muted">Palpites</div><div id="palpites" class="num">0</div></div>
  <div class="stat"><div class="muted">Vencedores</div><div id="vencedores" class="num">0</div></div>
  <div class="stat"><div class="muted">Resgates</div><div id="resgates" class="num">0</div></div>
</div>
<button class="btn green" onclick="toggle(true)">🔓 Abrir teste</button>
<button class="btn red" onclick="toggle(false)">🔒 Fechar teste</button>
<button class="btn orange" onclick="resetar()">🗑️ Zerar ambiente de teste</button>
<div class="box">
<b>Comandos de teste</b><br>
<code>/teste_iniciar_bolao Flamengo x Vasco 21h | FILE_ID_FOTO</code><br>
<code>/teste_fechar_bolao</code><br>
<code>/teste_ganhou</code> — responda ao palpite vencedor.<br><br>
Tudo usa tabelas <code>test_*</code>; produção não é alterada.
</div>
</div>
<script>
async function carregar(){const r=await fetch('/api/teste/bolao-status');const d=await r.json();document.getElementById('status').innerHTML='<b>Status:</b> '+(d.aberto?'🟢 ABERTO':'🔴 FECHADO')+'<br><b>Confronto:</b> '+(d.confronto||'Nenhum')+'<br><b>Post:</b> <code>'+(d.postId||'-')+'</code>';palpites.textContent=d.palpites||0;vencedores.textContent=d.vencedores||0;resgates.textContent=d.resgates||0}
async function toggle(aberto){await fetch('/api/teste/bolao-toggle',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({aberto})});carregar()}
async function resetar(){if(!confirm('Zerar todos os dados do ambiente de teste?'))return;await fetch('/api/teste/bolao-reset',{method:'POST'});carregar()}
carregar();
</script>
</body></html>`;

  return new Response(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
}
