const BASE = "https://www.doramasyt.com";
const UA = "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36";
const SERVERS = ["mp4upload", "ok", "lulu", "uqload", "voe"];

function decode(s) {
  return String(s || "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}
function safeId(s) { return String(s).replace(/[^A-Za-z0-9._~-]/g, "-").slice(0, 128); }
function proxyImg(u) {
  const m = String(u || "").match(/^https:\/\/(www\.doramasyt\.com\/[^?#]+)/);
  return m ? "https://i0.wp.com/" + m[1] : String(u || "");
}
function log(m) { try { kino.log(m); } catch (e) {} }

async function getText(url, headers) {
  const r = await kino.fetch(url, { headers: Object.assign({ "User-Agent": UA, "Accept-Language": "es" }, headers || {}) });
  if (!r.ok) {
    if (r.status === 404) throw kino.error("not_found", "HTTP 404");
    if (r.status === 429) throw kino.error("rate_limited", "HTTP 429");
    throw kino.error("unavailable", "HTTP " + r.status);
  }
  return r.text();
}

function parseCards(html) {
  const out = [];
  const seen = {};
  const re = /<a href="https:\/\/www\.doramasyt\.com\/dorama\/([a-z0-9-]+)"([^>]*)>([\s\S]*?)<\/a>/g;
  let m;
  while ((m = re.exec(html))) {
    const slug = m[1];
    if (seen[slug]) continue;
    const t = m[3].match(/title_cap[^>]*>([^<]+)</) || m[2].match(/title="Ver ([^"]+)"/);
    if (!t) continue;
    const img = m[3].match(/data-src="([^"]+)"/);
    const y = m[3].match(/(\d{4})\s*<\/span>/);
    seen[slug] = 1;
    out.push({ slug: slug, title: decode(t[1]).trim(), poster: img ? proxyImg(img[1]) : "", year: y ? y[1] : "" });
  }
  return out;
}
function toItem(c) {
  return {
    id: safeId(c.slug), ref: c.slug, title: c.title, kind: "series", poster: c.poster, year: c.year,
    badges: [c.slug.indexOf("-latino-") >= 0 ? "Latino" : "Subtitulado"],
  };
}

export async function search(query) {
  const q = String((query && query.q) || "").trim();
  if (!q) return parseCards(await getText(BASE + "/doramas")).slice(0, 100).map(toItem);
  const tries = [q];
  const dashed = q.replace(/\s+/g, "-");
  if (dashed !== q) tries.push(dashed);
  const first = q.split(/\s+/)[0];
  if (first !== q) tries.push(first);
  for (const t of tries) {
    const items = parseCards(await getText(BASE + "/buscar?q=" + encodeURIComponent(t)));
    if (items.length) return items.slice(0, 100).map(toItem);
  }
  return [];
}

export async function home() {
  const [nuevos, emision] = await Promise.all([getText(BASE + "/doramas"), getText(BASE + "/emision")]);
  const rows = [{ id: "nuevos", title: "Catálogo", ref: "nuevos", items: parseCards(nuevos).map(toItem) }];
  const e = parseCards(emision).map(toItem);
  if (e.length) rows.unshift({ id: "emision", title: "En emisión", ref: "emision", items: e });
  return rows;
}

const GENRES = [
  ["accion", "Acción"], ["c-drama", "C-Drama"], ["comedia", "Comedia"], ["drama", "Drama"],
  ["escolar", "Escolar"], ["fantasia", "Fantasía"], ["historico", "Histórico"], ["j-drama", "J-Drama"],
  ["k-drama", "K-Drama"], ["misterio", "Misterio"], ["romance", "Romance"], ["thai-drama", "Thai-Drama"],
];
const ART_KEY = "art:v1";
async function readArt() {
  try {
    const c = await kino.storage.get(ART_KEY);
    const raw = c && typeof c === "object" && "value" in c ? c.value : c;
    if (typeof raw === "string") {
      const o = JSON.parse(raw);
      if (o && typeof o === "object") return o;
    }
  } catch (e) {}
  return null;
}
async function genreArt(slug) {
  try {
    const html = await getText(BASE + "/genero/" + slug);
    const first = parseCards(html).find((c) => c.poster);
    return first ? first.poster : "";
  } catch (e) {
    log("arte " + slug);
    return "";
  }
}
export async function categories() {
  let art = await readArt();
  if (!art) {
    art = {};
    for (let i = 0; i < GENRES.length; i += 6) {
      const batch = GENRES.slice(i, i + 6);
      const posters = await Promise.all(batch.map((g) => genreArt(g[0])));
      batch.forEach((g, k) => { if (posters[k]) art[g[0]] = posters[k]; });
    }
    if (Object.keys(art).length) {
      try { await kino.storage.set(ART_KEY, JSON.stringify(art), { ttlMs: 6 * 3600 * 1000 }); } catch (e) {}
    }
  }
  return GENRES.map((g) => {
    const tile = { id: "g-" + g[0], title: g[1], ref: "g:" + g[0] };
    if (art[g[0]]) tile.art = art[g[0]];
    return tile;
  });
}

export async function browse(ref, cursor) {
  const page = cursor ? Number(cursor) || 1 : 1;
  const r = String(ref);
  let path = "/doramas";
  if (r === "emision") path = "/emision";
  else if (r.indexOf("g:") === 0) path = "/genero/" + r.slice(2).replace(/[^a-z0-9-]/g, "");
  const html = await getText(BASE + path + "?p=" + page);
  const items = parseCards(html).map(toItem);
  const more = new RegExp("[?&]p=" + (page + 1) + "(?!\\d)").test(html);
  return more ? { items: items, next: String(page + 1) } : { items: items };
}

const SECTION_TABS = [
  { id: "emision", label: "En emisión" },
  { id: "paises", label: "Países" },
  { id: "generos", label: "Géneros" },
];
const COUNTRY_SLUGS = ["k-drama", "c-drama", "j-drama", "thai-drama"];

async function rowFor(path, id, title, ref) {
  try {
    const html = await getText(BASE + path);
    const items = parseCards(html).slice(0, 24).map(toItem);
    return items.length ? { id: id, title: title, ref: ref, items: items } : null;
  } catch (e) {
    log("fila " + id);
    return null;
  }
}

export async function section(arg) {
  const want = arg && arg.tab;
  const tab = SECTION_TABS.some((t) => t.id === want) ? want : "emision";
  let rows = [];
  if (tab === "emision") {
    rows = await Promise.all([
      rowFor("/emision", "emision", "En emisión", "emision"),
      rowFor("/doramas", "catalogo", "Catálogo", "nuevos"),
    ]);
  } else {
    const list = GENRES.filter((g) => (COUNTRY_SLUGS.indexOf(g[0]) >= 0) === (tab === "paises"));
    for (let i = 0; i < list.length; i += 6) {
      const batch = list.slice(i, i + 6);
      const got = await Promise.all(batch.map((g) => rowFor("/genero/" + g[0], "g-" + g[0], g[1], "g:" + g[0])));
      rows = rows.concat(got);
    }
  }
  return { tabs: SECTION_TABS, tab: tab, rows: rows.filter(Boolean) };
}

export async function episodes(ref) {
  const slug = String(ref);
  const url = BASE + "/dorama/" + encodeURIComponent(slug);
  const html = await getText(url);
  const am = html.match(/data-ajax="[^"]*\/ajax_pagination\/(\d+)"/);
  const tm = html.match(/name="csrf-token" content="([^"]+)"/);
  if (!am || !tm) throw kino.error("unavailable", "sin lista de capitulos");
  const r = await kino.fetch(BASE + "/ajax/ajax_pagination/" + am[1], {
    method: "POST",
    headers: {
      "User-Agent": UA, Accept: "application/json", Referer: url,
      "X-Requested-With": "XMLHttpRequest", "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "_token=" + encodeURIComponent(tm[1]),
  });
  if (!r.ok) throw kino.error("unavailable", "HTTP " + r.status);
  let data = null;
  try { data = JSON.parse(await r.text()); } catch (e) {}
  const nums = ((data && data.eps) || []).map((e) => Number(e.num)).filter((n) => isFinite(n) && n >= 0);
  nums.sort((a, b) => a - b);
  const base = slug.replace(/-sub-espanol$/, "");
  const series = {};
  const h1 = html.match(/<h1[^>]*>([^<]+)/);
  const img = html.match(/property="og:image" content="([^"]+)"/);
  const ov = html.match(/property="og:description" content="([^"]+)"/);
  const ym = html.match(/Fecha de emisi[oó]n:<\/dt>\s*<dd>[^<]*?(\d{4})/);
  const genres = [];
  const gre = /genero\/[a-z0-9-]+"><span class="badge[^>]*>([^<]+)</g;
  let g;
  while ((g = gre.exec(html))) genres.push(decode(g[1]).trim());
  if (h1) series.title = decode(h1[1]).trim();
  if (img) series.poster = proxyImg(decode(img[1]));
  if (ov) series.overview = decode(ov[1]).replace(/^Ver .*?DoramasYT\.\s*/, "").trim();
  if (ym) series.year = ym[1];
  if (genres.length) series.genres = genres;
  return {
    series: series,
    episodes: nums.map((n) => ({ season: 1, number: n, ref: base + "|" + n, title: "Capítulo " + n })),
  };
}

// ---------- servidores de video ----------

function unpack(html) {
  const m = html.match(/\}\('((?:[^'\\]|\\.)*)',(\d+),(\d+),'((?:[^'\\]|\\.)*)'\.split\('\|'\)/);
  if (!m) return "";
  const al = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const base = Number(m[2]);
  const k = m[4].split("|");
  const p = m[1].replace(/\\'/g, "'").replace(/\\\\/g, "\\");
  return p.replace(/\b\w+\b/g, (w) => {
    let n = 0;
    for (const ch of w) n = n * base + al.indexOf(ch);
    return n < k.length && k[n] ? k[n] : w;
  });
}

async function embedUrl(token) {
  const html = await getText(BASE + "/reproductor?video=" + encodeURIComponent(token), { Referer: BASE + "/" });
  const re = /https?:\/\/[^"' <>]+/g;
  let m;
  while ((m = re.exec(html))) {
    if (!/jquery|favicon|cdnjs/.test(m[0])) return m[0];
  }
  return null;
}

async function fromMp4upload(url) {
  const html = await getText(url, { Referer: BASE + "/" });
  const m = html.match(/player\.src\(\{[\s\S]*?src:\s*"([^"]+)"/);
  if (!m) return null;
  return { url: m[1], mime: "video/mp4", headers: { Referer: "https://www.mp4upload.com/", "User-Agent": UA } };
}
async function fromOk(url) {
  const html = await getText(url, { Referer: BASE + "/" });
  const o = html.match(/data-options="([^"]+)"/);
  if (!o) return null;

  const decoded = decode(o[1]);
  let streamUrl = null;
  let mime = "application/x-mpegURL";

  const hls = decoded.match(/"hlsManifestUrl":"([^"]+)"/);
  if (hls) {
    streamUrl = hls[1].replace(/\\u0026/g, "&").replace(/\\\//g, "/");
  } else {
    const dash = decoded.match(/(https?:\/\/[^"']*?(?:okcdn\.ru|mycdn\.me)[^"']*?\.(?:mpd|m3u8|mp4)[^"']*)/);
    if (!dash) return null;
    streamUrl = dash[1].replace(/\\u0026/g, "&").replace(/\\\//g, "/");
    mime = streamUrl.includes(".mpd") ? "application/dash+xml"
         : streamUrl.includes(".m3u8") ? "application/x-mpegURL"
         : "video/mp4";
  }

  return {
    url: streamUrl,
    mime: mime,
    headers: {
      Referer: "https://ok.ru/",
      "User-Agent": UA,
      Origin: "https://ok.ru",
    },
  };
}
async function fromLulu(url) {
  const html = await getText(url, { Referer: BASE + "/" });
  const m = unpack(html).match(/https?:[^"'\s\\]+\.m3u8[^"'\s\\]*/);
  if (!m) return null;
  return { url: m[0], mime: "application/x-mpegURL", headers: { Referer: "https://luluvdo.com/", "User-Agent": UA } };
}
async function fromUqload(url) {
  const html = await getText(url, { Referer: BASE + "/" });
  const all = html + "\n" + unpack(html);
  const m = all.match(/https?:[^"'\s\\]+\.(?:mp4|m3u8)[^"'\s\\]*/);
  if (!m) return null;
  const u = m[0];
  return { url: u, mime: /m3u8/.test(u) ? "application/x-mpegURL" : "video/mp4", headers: { Referer: "https://uqload.com/", "User-Agent": UA } };
}
function b64(s) {
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}
function voeDecode(html) {
  const m = html.match(/<script type="application\/json"[^>]*>\s*\["([^"]+)"\]\s*<\/script>/);
  if (!m) return null;
  let t = m[1].replace(/[A-Za-z]/g, (c) => {
    const base = c <= "Z" ? 65 : 97;
    return String.fromCharCode((c.charCodeAt(0) - base + 13) % 26 + base);
  });
  for (const p of ["@$", "^^", "~@", "%?", "*~", "\x21\x21", "#&"]) t = t.split(p).join("");
  const a = b64(t);
  const s = Array.from(a).map((c) => String.fromCharCode(c.charCodeAt(0) - 3)).join("").split("").reverse().join("");
  return JSON.parse(b64(s));
}
async function fromVoe(url) {
  let html = await getText(url, { Referer: BASE + "/" });
  let from = url;
  if (html.indexOf('type="application/json"') < 0) {
    const r = html.match(/https:\/\/[a-z0-9.-]+\/e\/[a-z0-9]+/);
    if (!r) return null;
    from = r[0];
    html = await getText(from, { Referer: "https://voe.sx/" });
  }
  const o = voeDecode(html);
  if (!o || !o.source) return null;
  return { url: o.source, mime: "application/x-mpegURL", headers: { Referer: new URL(from).origin + "/", "User-Agent": UA } };
}
const READERS = { mp4upload: fromMp4upload, ok: fromOk, lulu: fromLulu, uqload: fromUqload, voe: fromVoe };

export async function resolve(ref) {
  const parts = String(ref).split("|");
  const html = await getText(BASE + "/ver/" + encodeURIComponent(parts[0]) + "-episodio-" + encodeURIComponent(parts[1] || "1"));
  const found = {};
  const re = /data-player="([^"]+)"[\s\S]*?data-usa-api="\d">([^<]+)</g;
  let m;
  while ((m = re.exec(html))) found[m[2].trim().toLowerCase()] = m[1];
  if (found.luluvdo && !found.lulu) found.lulu = found.luluvdo;
  let names = SERVERS.filter((s) => found[s]);
  if (parts[2]) names = names.filter((s) => s === parts[2].toLowerCase());
  if (!names.length) throw kino.error("not_found", "sin servidores");
  for (let k = 0; k < names.length; k++) {
    const name = names[k];
    try {
      const url = await embedUrl(found[name]);
      const r = url ? await READERS[name](url) : null;
      if (!r) { log("sin video en " + name); continue; }
      const stream = { url: r.url, mime: r.mime, headers: r.headers, label: name };
      if (!parts[2]) {
        const rest = names.slice(k + 1).map((n) => ({ label: n, ref: parts[0] + "|" + (parts[1] || "1") + "|" + n }));
        if (rest.length) stream.alternatives = rest;
      }
      return stream;
    } catch (e) {
      log("fallo " + name + ": " + (e && e.message));
    }
  }
  throw kino.error("unavailable", "ningun servidor respondio");
}
