import { createServer } from "node:http";
import { mkdirSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { once } from "node:events";

import { chromium } from "@playwright/test";

import { escapeHtml, inside } from "./lib.mjs";

const mime = { ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".png": "image/png", ".jpg": "image/jpeg" };

function sceneDocument(project, contract) {
  const source = readFileSync(inside(project.paths.composition, contract.scene), "utf8");
  const template = source.match(/<template(?:\s[^>]*)?>([\s\S]*)<\/template>/);
  if (!template) throw new Error(`State contracts target a self-contained leaf scene: ${contract.scene}`);
  if (template[1].includes("data-composition-src=")) throw new Error("State checks target leaf scenes; Hyperframes validates the assembled root separately.");
  const styles = ["assets/generated/project.css", ...project.stateStyles];
  styles.forEach((style) => inside(project.paths.composition, style));
  return `<!doctype html><html><head><meta charset="utf-8"><base href="/">${styles.map((style) => `<link rel="stylesheet" href="/${escapeHtml(style)}">`).join("")}
<script src="/assets/generated/gsap.min.js"></script><script>window.__timelines = {};</script></head><body>${template[1]}</body></html>`;
}

export async function checkStates(project, { screenshots = true } = {}) {
  const documents = project.stateContracts.map((contract) => {
    if (!contract.timeline || !Array.isArray(contract.samples) || contract.samples.length === 0) throw new Error("Each state contract needs a timeline and samples.");
    return sceneDocument(project, contract);
  });
  const serverErrors = [];
  const server = createServer((request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname === "/favicon.ico") {
      response.writeHead(204); response.end(); return;
    }
    const match = url.pathname.match(/^\/_state\/(\d+)$/);
    if (match && documents[Number(match[1])]) {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(documents[Number(match[1])]);
      return;
    }
    try {
      const file = inside(project.paths.composition, decodeURIComponent(url.pathname.slice(1)));
      response.writeHead(200, { "content-type": mime[extname(file)] ?? "application/octet-stream" });
      response.end(readFileSync(file));
    } catch (error) {
      serverErrors.push(error.message);
      response.writeHead(404, { "content-type": "text/plain" });
      response.end(error.message);
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = `http://127.0.0.1:${server.address().port}`;
  let browser;
  const results = [];
  const networkErrors = [];
  const pageErrors = [];
  try {
    browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: project.output.width, height: project.output.height } });
    await context.route("**/*", (route) => {
      const url = new URL(route.request().url());
      if (url.origin === origin) return route.continue();
      networkErrors.push(url.origin);
      return route.abort("blockedbyclient");
    });
    const page = await context.newPage();
    page.on("pageerror", (error) => pageErrors.push(error.message));
    const directory = join(project.paths.workspace, ".checks", "states");
    if (screenshots) mkdirSync(directory, { recursive: true });
    for (const [contractIndex, contract] of project.stateContracts.entries()) {
      await page.goto(`${origin}/_state/${contractIndex}`, { waitUntil: "networkidle" });
      if (pageErrors.length || serverErrors.length) throw new Error(`Scene initialization failed: ${[...pageErrors, ...serverErrors].join("; ")}`);
      await page.evaluate(() => document.fonts.ready);
      await page.waitForFunction((id) => Boolean(window.__timelines?.[id]), contract.timeline);
      for (const [pass, samples] of [["forward", contract.samples], ["backward", [...contract.samples].reverse()]]) {
        for (const [index, sample] of samples.entries()) {
          if (!Number.isFinite(sample.at) || sample.at < 0 || !Array.isArray(sample.assertions) || sample.assertions.length === 0) throw new Error("State samples need a non-negative time and assertions.");
          await page.evaluate(({ id, at }) => { window.__timelines[id].seek(at, false); }, { id: contract.timeline, at: sample.at });
          for (const assertion of sample.assertions) {
            const locator = page.locator(assertion.selector);
            const count = await locator.count();
            if (assertion.count !== undefined && count !== assertion.count) throw new Error(`${contract.scene}@${sample.at}: ${assertion.selector} count is ${count}, expected ${assertion.count}.`);
            if (count === 0 && assertion.count === 0) continue;
            if (count !== 1) throw new Error(`${contract.scene}@${sample.at}: assertion selector must match exactly one element: ${assertion.selector}`);
            const state = await locator.evaluate((element) => {
              const rect = element.getBoundingClientRect();
              let visible = rect.width > 0 && rect.height > 0;
              for (let parent = element; parent; parent = parent.parentElement) {
                const style = getComputedStyle(parent);
                visible &&= style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) > 0.01;
              }
              return { visible, text: element.textContent.trim().replace(/\s+/g, " "), attributes: Object.fromEntries([...element.attributes].map((attribute) => [attribute.name, attribute.value])) };
            });
            if (assertion.visible !== undefined && assertion.visible !== state.visible) throw new Error(`${contract.scene}@${sample.at}: incorrect visibility for ${assertion.selector}.`);
            if (assertion.text !== undefined && assertion.text !== state.text) throw new Error(`${contract.scene}@${sample.at}: text is "${state.text}", expected "${assertion.text}".`);
            if (assertion.contains !== undefined && !state.text.includes(assertion.contains)) throw new Error(`${contract.scene}@${sample.at}: missing "${assertion.contains}".`);
            if (assertion.notContains !== undefined && state.text.includes(assertion.notContains)) throw new Error(`${contract.scene}@${sample.at}: premature "${assertion.notContains}".`);
            for (const [name, value] of Object.entries(assertion.attributes ?? {})) {
              if ((state.attributes[name] ?? null) !== value) throw new Error(`${contract.scene}@${sample.at}: incorrect ${name} on ${assertion.selector}.`);
            }
          }
          results.push({ scene: contract.scene, pass, at: sample.at, assertions: sample.assertions.length });
          if (screenshots && pass === "forward") await page.screenshot({ path: join(directory, `${contractIndex}-${index}.png`) });
        }
      }
    }
    if (networkErrors.length) throw new Error(`State scenes attempted external requests: ${[...new Set(networkErrors)].join(", ")}`);
    if (pageErrors.length) throw new Error(`Composition runtime errors: ${pageErrors.join("; ")}`);
    if (serverErrors.length) throw new Error(`Composition assets failed: ${serverErrors.join("; ")}`);
    return results;
  } finally {
    await browser?.close();
    const closed = once(server, "close");
    server.close();
    await closed;
  }
}
