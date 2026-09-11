export async function renderRankingPage(request, env) {
  const html = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover" />
<meta name="theme-color" content="#0b0b0d" />
<title>Ranking Gols Flamengo</title>
<style>
:root{--bg:#08090b;--card:#111317;--card2:#17191f;--line:#262933;--txt:#f7f7f8;--muted:#a7abb6;--red:#e21f2f;--red2:#9f111c;--gold:#f6c85f;--silver:#cfd4dc;--bronze:#c98952}
*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at top,#2a080c 0,#0d0e11 32%,#08090b 70%);color:var(--txt);font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;min-height:100vh}
.wrap{max-width:760px;margin:0 auto;padding:24px 16px 40px}.hero{text-align:center;padding:10px 0 20px}.crest{width:58px;height:58px;border-radius:18px;margin:0 auto 12px;display:grid;place-items:center;background:linear-gradient(145deg,#e21f2f,#6e0a12);box-shadow:0 12px 32px #0008;font-size:30px}.hero h1{margin:0;font-size:28px;letter-spacing:-.7px}.hero p{margin:8px 0 0;color:var(--muted);font-size:14px}
.podium{display:grid;grid-template-columns:1fr 1.08fr 1fr;align-items:end;gap:10px;margin:18px 0 22px}.pod{background:linear-gradient(180deg,#17191f,#101216);border:1px solid var(--line);border-radius:22px 22px 14px 14px;text-align:center;padding:14px 8px 12px;position:relative;box-shadow:0 12px 30px #0005}.pod.first{min-height:190px;border-color:#5f4d20}.pod.second,.pod.third{min-height:166px}.medal{position:absolute;top:-12px;left:50%;transform:translateX(-50%);font-size:24px}.avatar{width:68px;height:68px;border-radius:50%;object-fit:cover;border:3px solid #fff2;background:#252833;margin:7px auto 9px;display:block}.first .avatar{width:82px;height:82px;border-color:#f6c85f}.second .avatar{border-color:#cfd4dc}.third .avatar{border-color:#c98952}.pod .name{font-weight:800;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.pod .pts{font-size:13px;color:var(--muted);margin-top:4px}.pod .pts b{color:#fff;font-size:18px}
.panel{background:#0e1014;border:1px solid var(--line);border-radius:20px;overflow:hidden}.panel-head{display:flex;justify-content:space-between;align-items:center;padding:16px 16px 12px}.panel-head h2{font-size:16px;margin:0}.refresh{border:1px solid var(--line);background:#17191f;color:#fff;border-radius:12px;padding:9px 11px;font-weight:700}.row{display:grid;grid-template-columns:42px 48px minmax(0,1fr) auto;gap:10px;align-items:center;padding:12px 14px;border-top:1px solid #1f222a}.pos{font-weight:900;color:#8e939f;text-align:center}.row img{width:46px;height:46px;border-radius:50%;object-fit:cover;background:#20232b}.who{min-width:0}.who strong{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:15px}.who span{display:block;color:var(--muted);font-size:12px;margin-top:3px}.score{text-align:right}.score b{font-size:18px}.score span{display:block;color:var(--muted);font-size:11px}.empty,.loading,.error{text-align:center;padding:34px 18px;color:var(--muted)}.error{color:#ff9fa7}.footer{text-align:center;color:#707582;font-size:12px;margin-top:18px}.pill{display:inline-flex;gap:6px;align-items:center;background:#1b1e25;border:1px solid #2b2f39;border-radius:999px;padding:7px 10px;color:#c8ccd4;font-size:12px;margin-top:10px}
@media(max-width:520px){.wrap{padding:18px 10px 28px}.hero h1{font-size:24px}.podium{gap:6px}.pod{padding-left:5px;padding-right:5px}.pod.first{min-height:176px}.pod.second,.pod.third{min-height:154px}.avatar{width:58px;height:58px}.first .avatar{width:72px;height:72px}.row{grid-template-columns:34px 44px minmax(0,1fr) auto;padding:11px 10px}.row img{width:42px;height:42px}}
</style>
</head>
<body>
<main class="wrap">
  <section class="hero">
    <div class="crest">🔴⚫</div>
    <h1>Ranking Gols Flamengo</h1>
    <p>Classificação oficial dos palpites</p>
    <div class="pill">🏆 Atualizado direto do D1</div>
  </section>

  <section id="podium" class="podium" aria-label="Pódio"></section>

  <section class="panel">
    <div class="panel-head"><h2>Classificação geral</h2><button class="refresh" id="refresh">Atualizar</button></div>
    <div id="list" class="loading">Carregando ranking...</div>
  </section>
  <div class="footer">Gols Flamengo • Cloudflare Worker + D1</div>
</main>
<script>
const podium=document.getElementById('podium');const list=document.getElementById('list');const btn=document.getElementById('refresh');
const esc=s=>String(s??'').replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]));
const userPhoto=u=>u.photo_url||('https://api.dicebear.com/7.x/initials/svg?seed='+encodeURIComponent(u.nome||u.name||'Torcedor')+'&backgroundColor=dc2626&textColor=ffffff&bold=true');
function podCard(u,pos,cls,medal){if(!u)return '<div></div>';return '<article class="pod '+cls+'"><div class="medal">'+medal+'</div><img class="avatar" src="'+esc(userPhoto(u))+'" alt=""><div class="name">'+esc(u.nome||u.name||'Torcedor')+'</div><div class="pts"><b>'+Number(u.pontos||u.total||0)+'</b> ponto(s)</div></article>'}
function draw(data){
  const r=Array.isArray(data)?data:[];
  podium.innerHTML=podCard(r[1],2,'second','🥈')+podCard(r[0],1,'first','🥇')+podCard(r[2],3,'third','🥉');
  if(!r.length){list.className='empty';list.textContent='Ainda não há pontuações no ranking.';return}
  list.className='';
  list.innerHTML=r.map((u,i)=>'<div class="row"><div class="pos">'+(i+1)+'º</div><img src="'+esc(userPhoto(u))+'" alt=""><div class="who"><strong>'+esc(u.nome||u.name||'Torcedor')+'</strong><span>'+((u.acertos&&u.acertos.length)?u.acertos.length:Number(u.pontos||u.total||0))+' acerto(s)</span></div><div class="score"><b>'+Number(u.pontos||u.total||0)+'</b><span>pontos</span></div></div>').join('');
}
async function load(){btn.disabled=true;list.className='loading';list.textContent='Atualizando...';try{const res=await fetch('/api/ranking_api',{cache:'no-store'});const data=await res.json();if(!res.ok||!data.ok)throw new Error(data.error||'Falha ao carregar');draw(data.ranking||[])}catch(e){list.className='error';list.textContent='Não foi possível carregar o ranking agora.'}finally{btn.disabled=false}}
btn.addEventListener('click',load);load();
</script>
</body></html>`;

  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer"
    }
  });
}
