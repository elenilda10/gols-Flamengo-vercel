import { searchGoals } from "../services/goals.js";

function html(body, title) {
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>
  :root{--bg:#0b0d10;--card:#161a21;--line:rgba(255,255,255,.08);--red:#dc2626;--muted:#94a3b8}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:#f8fafc;font-family:Arial,sans-serif;padding:20px}a{color:inherit}.wrap{max-width:880px;margin:auto;background:var(--card);border:1px solid var(--line);border-radius:22px;padding:24px}.head{display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap}.nav{display:flex;gap:8px;flex-wrap:wrap}.btn,.nav a{border:0;border-radius:10px;padding:11px 14px;font-weight:700;text-decoration:none;cursor:pointer}.nav a,.btn-secondary{background:#1e293b}.btn-primary{background:linear-gradient(135deg,#ef4444,#991b1b);color:#fff}.btn-danger{background:#dc2626;color:#fff}.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.field{display:flex;flex-direction:column;gap:6px;margin:12px 0}label{font-size:12px;color:#cbd5e1;font-weight:700;text-transform:uppercase}input{width:100%;padding:13px 14px;border-radius:10px;border:1px solid var(--line);background:#0b0d10;color:#fff}.alert{display:none;padding:12px;border-radius:10px;margin:14px 0}.searchrow{display:grid;grid-template-columns:1fr auto;gap:10px;align-items:end;margin:16px 0}table{width:100%;border-collapse:collapse;margin-top:16px}th,td{padding:12px;border-bottom:1px solid var(--line);text-align:left}th{color:#cbd5e1;font-size:12px}.muted{color:var(--muted);font-size:13px}.actions{display:flex;gap:6px;flex-wrap:wrap}@media(max-width:640px){.grid{grid-template-columns:1fr}.wrap{padding:18px}table{font-size:13px}.hide-mobile{display:none}}
  </style></head><body>${body}</body></html>`;
}

export async function processarGolsPages(request, env) {
  const url = new URL(request.url);

  if (url.pathname === "/api/painel-addgoal" && request.method === "GET") {
    const body = `<div class="wrap"><div class="head"><div><h1 id="panelTitle">⚽ Adicionar Novo Gol</h1><div class="muted" id="panelSubtitle">Preencha os campos para salvar no D1.</div></div><div class="nav"><a href="/api/lista-gols">📋 Acervo</a><a href="/api/painel-bolao">🏆 Bolão</a></div></div>
    <div id="alertBox" class="alert"></div>
    <div class="searchrow"><div class="field"><label>ID do gol para edição</label><input id="goal_id" placeholder="Ex: 1718362402941"></div><button class="btn btn-secondary" onclick="buscarGol()">🔍 Buscar</button></div>
    <form id="goalForm"><div class="field"><label>Confronto / Jogo</label><input id="jogo" required placeholder="Flamengo 2x1 Vasco"></div><div class="grid"><div class="field"><label>Autor</label><input id="autor" required></div><div class="field"><label>Assistência</label><input id="assistencia" required></div></div><div class="grid"><div class="field"><label>Campeonato</label><input id="campeonato" required></div><div class="field"><label>Fase / Rodada</label><input id="fase" required></div></div><div class="field"><label>Telegram FileID do vídeo</label><input id="file_id" required></div><div class="field"><label>ID Administrador</label><input type="password" id="admin_id" value="7717528550" required></div><button class="btn btn-primary" type="submit">💾 Salvar Gol</button></form></div>
    <script>
    const id=document.getElementById('goal_id'), box=document.getElementById('alertBox');
    const qs=new URLSearchParams(location.search); if(qs.get('edit_id')){id.value=qs.get('edit_id');buscarGol();}
    function aviso(txt,ok){box.style.display='block';box.style.background=ok?'#065f46':'#991b1b';box.textContent=txt}
    async function buscarGol(){if(!id.value.trim())return aviso('Digite um ID válido.',false);const r=await fetch('/api/getgoal?id='+encodeURIComponent(id.value.trim()));const d=await r.json();if(!d.ok)return aviso(d.error||'Gol não encontrado',false);for(const k of ['jogo','autor','assistencia','campeonato','fase','file_id'])document.getElementById(k).value=d.gol[k]||'';document.getElementById('panelTitle').textContent='📝 Editar Gol Existente';aviso('Dados carregados.',true)}
    document.getElementById('goalForm').addEventListener('submit',async e=>{e.preventDefault();const payload={id:id.value.trim(),jogo:jogo.value,autor:autor.value,assistencia:assistencia.value,campeonato:campeonato.value,fase:fase.value,file_id:file_id.value,admin_id:admin_id.value};if(!confirm('Confirma salvar este gol?'))return;const r=await fetch('/api/addgoal-action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});const d=await r.json();if(d.ok){aviso('✅ Gol salvo com ID '+d.id,true);id.value='';e.target.reset();admin_id.value='7717528550'}else aviso('❌ '+(d.error||'Erro ao salvar'),false)});
    </script>`;
    return new Response(html(body, "Painel de Gols"), { headers: { "Content-Type": "text/html; charset=utf-8" } });
  }

  if (url.pathname === "/api/lista-gols" && request.method === "GET") {
    const q = String(url.searchParams.get("q") || "").trim();
    let gols;
    if (q) {
      gols = await searchGoals(env.DB, q, { limit: 500, offset: 0 });
    } else {
      const { results = [] } = await env.DB.prepare(`SELECT * FROM gols ORDER BY CAST(criado_em AS INTEGER) DESC, CAST(id AS INTEGER) DESC LIMIT 30`).all();
      gols = results;
    }
    const totalRow = await env.DB.prepare("SELECT COUNT(*) AS total FROM gols").first();
    const total = q ? gols.length : (totalRow?.total || 0);
    const rows = gols.map(g => `<tr id="row_${g.id}"><td><code>${g.id}</code></td><td><strong>${g.jogo||'Jogo'}</strong><div class="muted">🏆 ${g.campeonato||'-'} | ${g.fase||'-'}</div></td><td>⚽ ${g.autor||'-'}<div class="muted">🅰 ${g.assistencia||'-'}</div></td><td><div class="actions"><a class="btn btn-secondary" href="/api/painel-addgoal?edit_id=${encodeURIComponent(g.id)}">📝 Editar</a><button class="btn btn-danger" onclick="apagar('${String(g.id).replace(/'/g,"\\'")}')">🗑️ Apagar</button></div></td></tr>`).join('');
    const body = `<div class="wrap"><div class="head"><h1>📋 Gols (${total})</h1><div class="nav"><a href="/api/painel-addgoal">➕ Novo</a><a href="/api/painel-bolao">🏆 Bolão</a></div></div><div class="searchrow"><input id="q" value="${q.replace(/"/g,'&quot;')}" placeholder="Buscar jogador, jogo, campeonato..."><button class="btn btn-secondary" onclick="buscar()">🔍 Buscar</button></div>${gols.length?`<div style="overflow:auto"><table><thead><tr><th>ID</th><th>Jogo</th><th>Gol</th><th>Ações</th></tr></thead><tbody>${rows}</tbody></table></div>`:'<p class="muted">Nenhum gol encontrado.</p>'}${!q?'<p class="muted">Exibindo os 30 gols mais recentes.</p>':''}</div><script>function buscar(){const v=document.getElementById('q').value.trim();location.href='/api/lista-gols'+(v?'?q='+encodeURIComponent(v):'')}document.getElementById('q').addEventListener('keydown',e=>{if(e.key==='Enter')buscar()});async function apagar(id){if(!confirm('Excluir este gol permanentemente?'))return;const r=await fetch('/api/deletegoal?id='+encodeURIComponent(id),{method:'DELETE'});const d=await r.json();if(d.ok){document.getElementById('row_'+id)?.remove()}else alert(d.error||'Erro ao excluir')}</script>`;
    return new Response(html(body, "Acervo de Gols"), { headers: { "Content-Type": "text/html; charset=utf-8" } });
  }

  return null;
}
