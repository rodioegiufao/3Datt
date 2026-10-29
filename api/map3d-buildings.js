// Proxy de consulta OSM/Overpass (mesma origem do site Vercel).
// Evita CORS no navegador; não é um proxy genérico.
const HOSTS = [
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.nchc.org.tw/api/interpreter',
  'https://overpass-api.de/api/interpreter',
];
const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' };
function reply(res, code, data) { res.status(code); Object.entries(headers).forEach(([k,v])=>res.setHeader(k,v)); res.json(data); }
export default async function handler(req,res) {
  if(req.method !== 'GET') { res.setHeader('Allow','GET'); return reply(res,405,{error:'Método não permitido'}); }
  const { south,west,north,east }=req.query||{};
  const b=[south,west,north,east].map(Number);
  if(b.some((x)=>!Number.isFinite(x)) || b[0]<-85 || b[2]>85 || b[1]<-180 || b[3]>180 || b[0]>=b[2] || b[1]>=b[3])return reply(res,400,{error:'Coordenadas inválidas'});
  const latM=(b[2]-b[0])*111320, lonM=(b[3]-b[1])*111320*Math.cos((b[0]+b[2])*Math.PI/360);
  if(latM>2100 || lonM>2100 || latM<1 || lonM<1)return reply(res,400,{error:'Área deve ter até 2 km por lado'});
  const query=`[out:json][timeout:22][maxsize:25000000];way["building"](${b.join(',')});out geom;`;
  const failures=[];
  for(const host of HOSTS){
    const ctrl=new AbortController();const timer=setTimeout(()=>ctrl.abort(),26000);
    try {
      const r=await fetch(host,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded; charset=UTF-8','Accept':'application/json','User-Agent':'Map3D-Exporter/1.1 (GIS viewer)'},body:new URLSearchParams({data:query}),signal:ctrl.signal});
      if(!r.ok)throw Error(`HTTP ${r.status}`);
      const json=await r.json();
      if(!Array.isArray(json.elements))throw Error('Resposta inesperada');
      // Devolve os elementos OSM; conversão para mesh continua no navegador.
      return reply(res,200,{elements:json.elements.filter(x=>x.type==='way' && Array.isArray(x.geometry)).slice(0,3000)});
    }catch(e){failures.push(`${new URL(host).hostname}: ${e.name==='AbortError'?'tempo excedido':e.message}`)}
    finally {clearTimeout(timer)}
  }
  return reply(res,502,{error:'Servidores Overpass indisponíveis ou limitados. Tente novamente com área menor.',details:failures});
}
