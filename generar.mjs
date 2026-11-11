// COPIA FIJA DE LA WEB PÚBLICA de la Asociación de Festejos de L'Entregu (www.festejoselentrego.com),
// para servirla desde GitHub Pages, fuera de Cloudflare (Mario, 11-11-2026: «me preocupa sobre todo la
// web pública»).
//
// La web se sigue haciendo y editando en la gestión (Cloudflare). Este programa pide cada página al Worker
// por su dirección de workers.dev con la clave COPIA_SECRETO, y el Worker se la sirve tal cual sería en
// www (con el formulario de contacto y el contador de visitas apuntando a Cloudflare). Recorre los enlaces,
// guarda páginas, fotos, letras y vídeos en _site/, y comprueba que está todo antes de dejar publicarla:
// si algo falla, sale con error y en www se queda la copia anterior.
//
// Uso:  ORIGEN=https://socios-festejos.festejoslentregu.workers.dev COPIA_SECRETO=… DOMINIO=www.festejoselentrego.com \
//       [PRUEBA=1] node generar.mjs [--si-cambia]
//   --si-cambia  solo la rehace si la web ha cambiado (compara la firma con la de la copia publicada).
//   PRUEBA=1     copia de prueba: nada se indexa en Google (noindex y robots.txt que lo prohíbe todo).
import { mkdir, writeFile, rm, appendFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const ORIGEN = String(process.env.ORIGEN || '').replace(/\/+$/, '');
const CLAVE = process.env.COPIA_SECRETO || '';
const DOMINIO = String(process.env.DOMINIO || '').trim();
const PRUEBA = process.env.PRUEBA === '1';
const PRINCIPAL = 'https://www.festejoselentrego.com'; // la web de verdad: los enlaces de las páginas van aquí
const SALIDA = '_site';
const MIN_PAGINAS = 8;
const MAX_BYTES = 800 * 1024 * 1024; // GitHub Pages admite 1 GB
// Lo que no es la web pública (otras direcciones o cosas que solo responden a envíos).
const FUERA = /^\/(junta|alta|gracias|privacidad|stripe|api|pagar|renovar|c|d|contacto|visita|correo|copia-firma)(\/|$)/;

if (!ORIGEN || !CLAVE || !DOMINIO) {
  console.error('Faltan ORIGEN, COPIA_SECRETO o DOMINIO.');
  process.exit(1);
}

const salidaGithub = (clave, valor) => (process.env.GITHUB_OUTPUT ? appendFile(process.env.GITHUB_OUTPUT, `${clave}=${valor}\n`) : Promise.resolve());

async function pedir(ruta, intentos = 3) {
  for (let i = 1; ; i++) {
    try {
      return await fetch(`${ORIGEN}${ruta}`, { headers: { 'x-copia': CLAVE, 'user-agent': 'copia-web-aflen' }, redirect: 'manual', signal: AbortSignal.timeout(60000) });
    } catch (e) {
      if (i >= intentos) throw new Error(`${ruta}: ${e.message}`);
      await new Promise((r) => setTimeout(r, 2000 * i));
    }
  }
}

// ---------- Avisar a la gestión de que la copia ya está publicada (paso final del flujo) ----------
// Con esa firma la gestión sabe si la copia está al día; si se atrasa más de una hora, www vuelve a Cloudflare.
if (process.argv.includes('--avisar')) {
  const { readFile } = await import('node:fs/promises');
  const hecha = (await readFile(join(SALIDA, 'copia-firma.txt'), 'utf8')).trim();
  const r = await fetch(`${ORIGEN}/copia-hecha`, { method: 'POST', headers: { 'x-copia': CLAVE, 'content-type': 'text/plain' }, body: hecha, signal: AbortSignal.timeout(30000) });
  if (!r.ok) { console.error('La gestión no ha aceptado el aviso:', r.status); process.exit(1); }
  console.log('Aviso dado:', hecha);
  process.exit(0);
}

// ---------- ¿Ha cambiado algo? ----------
// La gestión da la firma de la web y, en «x-copia-publicada», la de la última copia que avisó.
const { firma, publicada } = await (async () => {
  const r = await pedir('/copia-firma');
  if (!r.ok) throw new Error(`Sin firma (${r.status}): ¿está bien la clave COPIA_SECRETO?`);
  return { firma: (await r.text()).trim(), publicada: (r.headers.get('x-copia-publicada') || '').trim() };
})();
if (process.argv.includes('--si-cambia')) {
  if (publicada === firma) {
    console.log('La web no ha cambiado:', firma);
    await salidaGithub('cambia', 'false');
    process.exit(0);
  }
  console.log('La web ha cambiado:', publicada || '(sin copia)', '→', firma);
}

// ---------- Recorrer la web ----------
const paginas = new Map(); // ruta → html
const archivos = new Map(); // ruta → bytes
const saltos = new Map(); // ruta → destino (las redirecciones de la web)
const vistas = new Set();
const cola = [];
const fallos = [];

const esArchivo = (ruta) => /\.[a-z0-9]{2,5}$/i.test(ruta);
// `relativa`: solo dentro de las hojas de estilo (url(images/x.png)); en lo demás, una dirección empieza por
// «/» o por la de la web (así no se toman por direcciones las descripciones de los <meta content>).
function poner(url, base = '/', relativa = false) {
  const v = String(url).trim().replace(/&amp;/g, '&');
  if (!relativa && !v.startsWith('/') && !v.startsWith(PRINCIPAL)) return;
  if (v.startsWith('//') || /\s/.test(v)) return;
  let u;
  try { u = new URL(v, `${PRINCIPAL}${base}`); } catch { return; }
  if (u.origin !== PRINCIPAL) return;
  let ruta;
  try { ruta = decodeURI(u.pathname); } catch { return; }
  if (ruta.length > 1) ruta = ruta.replace(/\/+$/, '');
  if (FUERA.test(ruta) || vistas.has(ruta)) return;
  vistas.add(ruta);
  cola.push(ruta);
}

// Todas las direcciones que aparecen en una página, una hoja de estilos o un programa.
function enlaces(texto, base, css = false) {
  const t = String(texto);
  for (const m of t.matchAll(/\b(?:href|src|poster|content|data-src|data-video|data-foto)=["']([^"']+)["']/gi)) poner(m[1], base);
  for (const m of t.matchAll(/\b(?:srcset|imagesrcset)=["']([^"']+)["']/gi)) for (const p of m[1].split(',')) poner(p.trim().split(/\s+/)[0], base);
  for (const m of t.matchAll(/url\(\s*['"]?([^'")\s]+)['"]?\s*\)/gi)) if (!m[1].startsWith('data:')) poner(m[1], base, css);
  for (const m of t.matchAll(/https:\/\/www\.festejoselentrego\.com(\/[^\s"'<>)\\]*)/g)) poner(m[1], base);
  for (const m of t.matchAll(/["'`](\/(?:web|fotos|fuentes|ast)\/[^"'`\s]+)["'`]/g)) poner(m[1], base);
}

async function una(ruta) {
  const r = await pedir(ruta);
  if ([301, 302, 303, 307, 308].includes(r.status)) {
    const destino = new URL(r.headers.get('location'), `${PRINCIPAL}${ruta}`);
    if (destino.origin === PRINCIPAL && !esArchivo(ruta)) saltos.set(ruta, destino.pathname + destino.search);
    poner(destino.href, ruta);
    return;
  }
  // Lo que tampoco existe en la web de verdad (una foto borrada…) no frena la copia: se avisa.
  if (r.status === 404) { console.log('  aviso, no existe:', ruta); return; }
  if (!r.ok) { fallos.push(`${ruta}: ${r.status}`); return; }
  const tipo = r.headers.get('content-type') || '';
  if (tipo.includes('text/html') && !esArchivo(ruta)) {
    const html = await r.text();
    if (!html.includes('</html>')) { fallos.push(`${ruta}: página cortada`); return; }
    paginas.set(ruta, html);
    enlaces(html, ruta);
    return;
  }
  const datos = new Uint8Array(await r.arrayBuffer());
  archivos.set(ruta, datos);
  if (/text\/css|javascript|xml|text\/plain/.test(tipo)) enlaces(new TextDecoder().decode(datos), ruta, tipo.includes('text/css'));
}

// Por dónde empezar: la portada, el asturiano, el mapa del sitio y lo que leen buscadores e IA.
// /inicio era la portada en Hostinger: el Worker la manda a /, y aquí queda como redirección.
// Y lo que se pide sin enlace: el icono de la pestaña y la clave de IndexNow (pública a propósito: Bing la
// pide para saber que los avisos de cambios son de verdad nuestros; INDEXNOW_CLAVE en la gestión).
for (const r of ['/', '/ast', '/inicio', '/ast/inicio', '/robots.txt', '/sitemap.xml', '/llms.txt', '/llms-full.txt',
  '/favicon.ico', '/0c28b0fab9c7795c148ea69036e4a61a.txt']) poner(r);
const mapa = await pedir('/sitemap.xml');
if (mapa.ok) for (const m of (await mapa.clone().text()).matchAll(/<loc>([^<]+)<\/loc>/g)) poner(m[1]);

while (cola.length) {
  const tanda = cola.splice(0, 6);
  await Promise.all(tanda.map((r) => una(r).catch((e) => fallos.push(e.message))));
}

// La página de «no existe» (GitHub Pages la sirve como 404.html).
const no = await pedir('/esta-pagina-no-existe-copia');
const pagina404 = no.status === 404 ? await no.text() : '';
if (pagina404.includes('</html>')) enlaces(pagina404, '/');
while (cola.length) {
  const tanda = cola.splice(0, 6);
  await Promise.all(tanda.map((r) => una(r).catch((e) => fallos.push(e.message))));
}

// ---------- Comprobar antes de publicar ----------
const bytes = [...paginas.values()].reduce((s, h) => s + h.length, 0) + [...archivos.values()].reduce((s, b) => s + b.length, 0);
console.log(`${paginas.size} páginas, ${archivos.size} archivos, ${saltos.size} redirecciones, ${(bytes / 1048576).toFixed(1)} MB`);
if (fallos.length) {
  console.error('FALLOS:\n  ' + fallos.join('\n  '));
  process.exit(1);
}
if (paginas.size < MIN_PAGINAS || !paginas.has('/') || !pagina404) {
  console.error(`Copia incompleta (${paginas.size} páginas, portada: ${paginas.has('/')}, 404: ${Boolean(pagina404)}): no se publica.`);
  process.exit(1);
}
if (bytes > MAX_BYTES) {
  console.error('La copia pasa de 800 MB: no se publica.');
  process.exit(1);
}

// ---------- Guardar ----------
const prueba = (html) => (PRUEBA ? html.replace(/<meta name="robots"[^>]*>/g, '').replace('<head>', '<head><meta name="robots" content="noindex, nofollow">') : html);
// /x → x.html (GitHub Pages sirve /x desde x.html); la portada, index.html.
const archivoDe = (ruta) => (ruta === '/' ? 'index.html' : `${ruta.slice(1)}.html`);
await rm(SALIDA, { recursive: true, force: true });
async function guardar(nombre, datos) {
  const f = join(SALIDA, nombre);
  await mkdir(dirname(f), { recursive: true });
  await writeFile(f, datos);
}
for (const [ruta, html] of paginas) await guardar(archivoDe(ruta), prueba(html));
for (const [ruta, datos] of archivos) {
  if (PRUEBA && ruta === '/robots.txt') continue;
  await guardar(ruta.slice(1), datos);
}
if (PRUEBA) await guardar('robots.txt', 'User-agent: *\nDisallow: /\n');
for (const [ruta, destino] of saltos) {
  if (paginas.has(ruta)) continue;
  const a = JSON.stringify(destino);
  await guardar(archivoDe(ruta), `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Festejos L'Entregu</title>
<meta name="robots" content="noindex"><link rel="canonical" href="${PRINCIPAL}${destino}">
<meta http-equiv="refresh" content="0; url=${destino}"></head><body><script>location.replace(${a} + location.hash)</script>
<p><a href="${destino}">Festejos L'Entregu</a></p></body></html>\n`);
}
await guardar('404.html', prueba(pagina404));
await guardar('copia-firma.txt', `${firma}\n`);
console.log('Copia lista en', SALIDA, PRUEBA ? '(de prueba: sin Google)' : '');
await salidaGithub('cambia', 'true');
