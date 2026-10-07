// Pruebas sin conexión: cada respuesta sale de las grabaciones test/fx-*.json.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validate } from "../sdk/validate.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(join(root, "kino-plugin.json"), "utf8"));

async function run(file, fn, ...args) {
  const r = await validate(root, { run: fn, args, replay: join(root, "test", file) });
  assert.deepEqual(r.problems, []);
  assert.deepEqual(r.drops, []);
  return r.output;
}
const itemsOf = (o) => (Array.isArray(o) ? o : o.items || []);

test("Kino acepta el manifiesto y las funciones", async () => {
  const r = await validate(root);
  assert.deepEqual(r.problems, []);
});

test("el manifiesto cumple las reglas del plugin", () => {
  assert.equal(manifest.apiVersion, 5);
  assert.equal(manifest.entry, "plugin.js");
  assert.ok(!manifest.debug);
  assert.ok(!manifest.icon || !manifest.icon.startsWith("./"));
  assert.ok(manifest.capabilities.includes("download"));
  assert.ok(manifest.hosts.includes("uqload.vc"));
});

test("la búsqueda devuelve títulos", async () => {
  const items = itemsOf(await run("fx-search.json", "search", "kim"));
  assert.ok(items.length >= 1);
  assert.ok(items.every((i) => i.title && i.ref));
});

test("el inicio trae filas con series", async () => {
  const out = await run("fx-home.json", "home");
  const rows = Array.isArray(out) ? out : out.rows || [];
  assert.ok(rows.length >= 1);
  assert.ok(rows[0].items.length > 0);
});

test("ver más trae la página siguiente", async () => {
  const out = await run("fx-browse.json", "browse", "nuevos", "2");
  assert.ok(itemsOf(out).length > 0);
  assert.equal(out.next, "3");
});

test("los capítulos salen numerados", async () => {
  const out = await run("fx-episodes.json", "episodes", "our-sticky-love-sub-espanol");
  assert.ok(out.episodes.length >= 1);
  assert.equal(out.episodes[0].number, 1);
  assert.equal(out.episodes[0].ref, "our-sticky-love|1");
});

test("resolve entrega un mp4 por https", async () => {
  const s = await run("fx-resolve.json", "resolve", "our-sticky-love|1");
  assert.ok(s.url.startsWith("https://"));
  assert.equal(s.mime, "video/mp4");
});

test("uqload y ok.ru entregan HLS", async () => {
  const u = await run("fx-uq.json", "resolve", "komi-san-wa-komyushou-desu-live-action|1|uqload");
  assert.ok(u.url.includes(".m3u8"));
  const o = await run("fx-ok.json", "resolve", "komi-san-wa-komyushou-desu-live-action|1|ok");
  assert.ok(o.url.includes(".m3u8"));
});

test("las portadas pasan por el servicio de imágenes", async () => {
  const items = itemsOf(await run("fx-search.json", "search", "kim"));
  const posters = items.map((i) => i.poster).filter(Boolean);
  assert.ok(posters.length >= 1);
  assert.ok(posters.every((p) => p.startsWith("https://i0.wp.com/www.doramasyt.com/")));
});

test("voe entrega HLS", async () => {
  const s = await run("fx-voe.json", "resolve", "whats-wrong-with-secretary-kim-latino|16|voe");
  assert.ok(s.url.includes(".m3u8"));
});
