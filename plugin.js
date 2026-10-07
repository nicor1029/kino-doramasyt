const BASE = "https://www.doramasyt.com";
const UA = "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36";
const SERVERS = ["mp4upload", "ok", "lulu", "uqload"];

function decode(s) {
  return String(s || "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}
function safeId(s) { return String(s).replace(/[^A-Za-z0-9._~-]/g, "-").slice(0, 128); }
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
    out.push({ slug: slug, title: decode(t[1]).trim(), poster: img ? img[1] : "", year: y ? y[1] : "" });
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
  const html = q ? await getText(BASE + "/buscar?q=" + encodeURIComponent(q)) : await getText(BASE + "/doramas");
  return parseCards(html).slice(0, 100).map(toItem);
}

export async function home() {
  const [nuevos, emision] = await Promise.all([getText(BASE + "/doramas"), getText(BASE + "/emision")]);
  const rows = [{ id: "nuevos", title: "Catálogo", ref: "nuevos", items: parseCards(nuevos).map(toItem) }];
  const e = parseCards(emision).map(toItem);
  if (e.length) rows.unshift({ id: "emision", title: "En emisión", ref: "emision", items: e });
  return rows;
}

export async function browse(ref, cursor) {
  const page = cursor ? Number(cursor) || 1 : 1;
  const path = String(ref) === "emision" ? "/emision" : "/doramas";
  const html = await getText(BASE + path + "?p=" + page);
  const items = parseCards(html).map(toItem);
  const more = new RegExp("[?&]p=" + (page + 1) + "(?!\\d)").test(html);
  return more ? { items: items, next: String(page + 1) } : { items: items };
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
  if (img) series.poster = decode(img[1]);
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
  const m = decode(o[1]).match(/"hlsManifestUrl":"([^"]+)"/);
  if (!m) return null;
  const u = m[1].replace(/\\u0026/g, "&").replace(/\\\//g, "/");
  return { url: u, mime: "application/x-mpegURL", headers: { Referer: "https://ok.ru/", "User-Agent": UA } };
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
const READERS = { mp4upload: fromMp4upload, ok: fromOk, lulu: fromLulu, uqload: fromUqload };

export async function resolve(ref) {
  const parts = String(ref).split("|");
  const html = await getText(BASE + "/ver/" + encodeURIComponent(parts[0]) + "-episodio-" + encodeURIComponent(parts[1] || "1"));
  const found = {};
  const re = /data-player="([^"]+)"[\s\S]*?data-usa-api="\d">([^<]+)</g;
  let m;
  while ((m = re.exec(html))) found[m[2].trim().toLowerCase()] = m[1];
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
