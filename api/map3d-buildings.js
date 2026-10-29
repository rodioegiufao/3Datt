// Vercel API: geometria OSM para seleção de terreno (sem chamadas cross-origin no navegador).
// Overpass é a origem principal. Para recortes pequenos, a API OSM 0.6 é fallback.
const OVERPASS = [
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];
const MAX_JSON_BYTES = 16_000_000;
function respond(res, status, body) {
  res.setHeader('Cache-Control', status === 200 ? 'public, s-maxage=300, stale-while-revalidate=600' : 'no-store');
  return res.status(status).json(body);
}
async function request(url, init = {}, ms = 8000) {
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), ms);
  try {
    const response = await fetch(url, { ...init, signal: ctrl.signal, headers: { Accept: 'application/json', ...init.headers } });
    if (!response.ok) throw Error(`HTTP ${response.status}`);
    const length = Number(response.headers.get('content-length') || 0);
    if (length > MAX_JSON_BYTES) throw Error('resposta maior que o limite permitido');
    const raw = await response.text();
    if (raw.length > MAX_JSON_BYTES) throw Error('resposta excede o limite permitido');
    return JSON.parse(raw);
  } finally { clearTimeout(timeout); }
}
function fromOverpass(data) {
  if (!Array.isArray(data.elements)) throw Error('JSON sem elementos OSM');
  return data.elements.filter(e => e.type === 'way' && e.tags?.building && Array.isArray(e.geometry) && e.geometry.length >= 4)
    .slice(0, 3000).map(e => ({ type: 'way', id: e.id, tags: e.tags, geometry: e.geometry }));
}
function fromOsmMap(data) {
  if (!Array.isArray(data.elements)) throw Error('Resposta OSM inválida');
  const nodes = new Map(data.elements.filter(e => e.type === 'node').map(e => [e.id, e]));
  return data.elements.filter(e => e.type === 'way' && e.tags?.building && Array.isArray(e.nodes))
    .slice(0, 3000).map(e => ({ type:'way', id:e.id, tags:e.tags,
      geometry:e.nodes.map(id => nodes.get(id)).filter(Boolean).map(n => ({ lat:n.lat, lon:n.lon }))
    })).filter(e => e.geometry.length >= 4);
}
export default async function handler(req, res) {
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return respond(res, 405, { error:'Método não permitido' }); }
  const { south, west, north, east } = req.query || {};
  if ([south,west,north,east].some(x => x === undefined || x === '')) return respond(res,400,{error:'Coordenadas obrigatórias'});
  const b = [south,west,north,east].map(Number);
  if (b.some(x => !Number.isFinite(x)) || b[0] < -85 || b[2] > 85 || b[1] < -180 || b[3] > 180 || b[0] >= b[2] || b[1] >= b[3])
    return respond(res,400,{error:'Coordenadas inválidas'});
  const height = (b[2]-b[0])*111320, width = (b[3]-b[1])*111320*Math.cos((b[0]+b[2])*Math.PI/360);
  if (height < 1 || width < 1 || height > 2000 || width > 2000)
    return respond(res,400,{error:'Área permitida: de 1 m a 2 km por lado'});
  const query = `[out:json][timeout:8];way["building"](${b.join(',')});out geom;`;
  const tasks = OVERPASS.slice(0, 2).map(host =>
    request(host, { method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'}, body:new URLSearchParams({ data:query }) }, 6500)
      .then(data => ({ elements:fromOverpass(data), source:'overpass' }))
      .catch(err => { throw Error(`${new URL(host).hostname}: ${err.name === 'AbortError' ? 'timeout' : err.message}`); })
  );
  // API oficial OSM: alternativa somente para área pequena, e nunca para downloads em massa.
  if (width * height <= 250_000) {
    const bbox = [b[1],b[0],b[3],b[2]].join(',');
    tasks.push(request(`https://api.openstreetmap.org/api/0.6/map?bbox=${bbox}`, {}, 6500)
      .then(data => ({ elements:fromOsmMap(data), source:'osm-api-fallback' }))
      .catch(err => { throw Error(`api.openstreetmap.org: ${err.name === 'AbortError' ? 'timeout' : err.message}`); }));
  }
  try {
    return respond(res,200,await Promise.any(tasks));
  } catch (err) {
    const details = err.errors?.map(e => e.message) || [err.message];
    console.error('Map3D fontes indisponíveis', details);
    return respond(res,502,{error:'Não foi possível consultar os edifícios agora. Desmarque “Incluir edificações OpenStreetMap” para exportar somente o terreno.',details});
  }
}
