import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";

import { chromium } from "@playwright/test";

const root = dirname(fileURLToPath(import.meta.url));
let browser;
let page;

before(async () => {
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const font = readFileSync(join(root, "node_modules/@fontsource-variable/geist/files/geist-latin-wght-normal.woff2")).toString("base64");
  const logo = readFileSync(resolve(root, "../../public/icon.svg")).toString("base64");
  const css = readFileSync(join(root, "assets/brand.css"), "utf8")
    .replace('url("geist.woff2")', `url("data:font/woff2;base64,${font}")`);
  const gsap = readFileSync(join(root, "node_modules/gsap/dist/gsap.min.js"), "utf8");
  const scene = readFileSync(join(root, "scenes/personal.html"), "utf8")
    .replace("<template>", "").replace("</template>", "")
    .replaceAll('src="assets/icon.svg"', `src="data:image/svg+xml;base64,${logo}"`);
  await page.setContent(`<html><head><style>${css}</style><script>${gsap}</script><script>window.__timelines = {};</script></head><body>${scene}</body></html>`);
  await page.evaluate(() => document.fonts.ready);
});

after(async () => {
  await browser?.close();
});

async function seek(time) {
  await page.evaluate((seconds) => { window.__timelines.personal.seek(seconds, false); }, time);
}

async function opacity(selector) {
  return page.locator(selector).evaluate((element) => Number(getComputedStyle(element).opacity));
}

test("the list chooser is not checked or already added before selection", async () => {
  await seek(1.62);
  assert.ok(await opacity("#personal-menu") > 0.99);
  assert.equal((await page.locator("#personal-select").textContent()).trim(), "My list");
  assert.equal(await page.locator("#personal-select").getAttribute("class"), "add-option");
  assert.ok(await opacity("#personal-saved") < 0.01);
});

test("the added confirmation appears only after the selection has completed", async () => {
  await seek(2.7);
  assert.ok(await opacity("#personal-browse") < 0.01);
  assert.ok(await opacity("#personal-saved") > 0.99);
  assert.ok(await opacity("#personal-added") > 0.99);
  assert.match(await page.locator("#personal-added").textContent(), /Added to My list/);
});

test("marking watched changes the list before the optional rating is saved", async () => {
  await seek(4.2);
  assert.ok(await opacity("#personal-saved") < 0.01);
  assert.ok(await opacity("#personal-watched") > 0.99);
  assert.match(await page.locator("#personal-watched-tab").textContent(), /Watched\s+1/);
  assert.ok(await opacity("#personal-rating-unset") > 0.99);
  assert.ok(await opacity("#personal-rating-saved") < 0.01);
  assert.ok(await opacity("#personal-score-empty") > 0.99);
  assert.ok(await opacity("#personal-score-number") < 0.01);
});

test("the score starts empty, follows the drag, and is only saved after Save", async () => {
  await seek(4.58);
  const middle = Number.parseFloat(await page.locator("#personal-score-number").textContent());
  assert.ok(middle > 5.5 && middle < 8.5);
  await seek(4.95);
  assert.equal(await page.locator("#personal-score-number").textContent(), "8.5 / 10");
  assert.ok(await opacity("#personal-rating-saved") < 0.01);
  await seek(6);
  assert.ok(await opacity("#personal-rating") < 0.01);
  assert.ok(await opacity("#personal-rating-saved") > 0.99);
  assert.ok(await opacity("#personal-rating-unset") < 0.01);
});

test("seeking backwards cannot retain an added or rated state", async () => {
  await seek(6.38);
  await seek(1.62);
  assert.equal((await page.locator("#personal-select").textContent()).trim(), "My list");
  assert.ok(await opacity("#personal-saved") < 0.01);
  await seek(4.2);
  assert.ok(await opacity("#personal-score-empty") > 0.99);
  assert.ok(await opacity("#personal-rating-saved") < 0.01);
});
