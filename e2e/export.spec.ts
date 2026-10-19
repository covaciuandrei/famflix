import { readFile } from "node:fs/promises";

import { test, request as playwrightRequest, type Page } from "@playwright/test";

import { addTo, admin, createUser, expect, openAs, openFamily, setSlider, startFamily } from "./helpers";

/** Presses a download button on Settings and returns the file it saved: its name and what is in it. */
async function download(page: Page, button: string) {
  const saved = page.waitForEvent("download");
  await page.getByRole("button", { name: button }).click();
  const file = await saved;
  return { name: file.suggestedFilename(), text: await readFile((await file.path())!, "utf8") };
}

test("download my data: everything of mine, as JSON and as a CSV of what I watched, and nothing of anyone else's", async ({ browser }, testInfo) => {
  const ana = await createUser("Ana");
  const bogdan = await createUser("Bogdan");
  const anaPage = await openAs(browser, testInfo.project, ana);
  const bogdanPage = await openAs(browser, testInfo.project, bogdan);
  await startFamily(anaPage, [bogdanPage], "Export family");

  // Ana adds Dune to the family and logs that she and Bogdan watched it, with a note of hers (that starts like a spreadsheet
  // formula, to see it can't run there) and a score for him.
  await anaPage.goto("/app/media/movie/438631");
  await addTo(anaPage, anaPage, "Export family");
  await expect(anaPage.getByRole("img", { name: /On Export family/ })).toBeVisible();
  await openFamily(anaPage, "Export family");
  await anaPage.getByRole("button", { name: "Watched together", exact: true }).click();
  const dialog = anaPage.getByRole("dialog", { name: /Who watched Dune/ });
  await dialog.getByRole("checkbox", { name: "Bogdan" }).check();
  await setSlider(dialog.locator("li", { hasText: "Bogdan" }).locator('input[type="range"]'), 8.5);
  await dialog.getByRole("textbox", { name: "Your note" }).fill("=ANA-NOTE-FOR-DUNE");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toBeHidden();

  // Bogdan has a note of his own on it.
  await admin.from("ratings").update({ comment: "BOGDAN-SECRET-NOTE" }).eq("user_id", bogdan.id);

  // Ana's JSON: her account (with the e-mail of her sign-in), her My list entry with who she watched it with, her part of the
  // family's list; and nothing of Bogdan's but his name.
  await anaPage.goto("/app/settings");
  const json = await download(anaPage, "Everything (JSON)");
  expect(json.name).toMatch(/^famflix-data-\d{4}-\d{2}-\d{2}\.json$/);
  const doc = JSON.parse(json.text);
  expect(doc.account).toMatchObject({ id: ana.id, display_name: "Ana", email: ana.email });
  expect(doc.families.map((f: { name: string }) => f.name)).toEqual(["Export family"]);
  const dune = doc.my_list.find((e: { title: string }) => e.title === "Dune");
  expect(dune).toMatchObject({
    status: "watched",
    my_note: "=ANA-NOTE-FOR-DUNE",
    watched_with: { family: "Export family", people: ["Bogdan"] },
  });
  expect(doc.family_lists[0]).toMatchObject({ family: "Export family", still_a_member: true });
  expect(doc.family_lists[0].titles[0]).toMatchObject({ title: "Dune", added_by_me: true, my_note: "=ANA-NOTE-FOR-DUNE" });
  expect(doc.movie_nights).toHaveLength(1);
  expect(doc.not_included.length).toBeGreaterThan(0);
  for (const secret of ["BOGDAN-SECRET-NOTE", bogdan.email, bogdan.id]) expect(json.text).not.toContain(secret);

  // Her CSV: one row for the evening, with the family and Bogdan and her note; the file starts with a byte order mark.
  const csv = await download(anaPage, "Watch history (CSV)");
  expect(csv.name).toMatch(/^famflix-data-\d{4}-\d{2}-\d{2}\.csv$/);
  expect(csv.text.startsWith("\uFEFFdate,kind,title,season,episode,year,where,with,score,note\r\n")).toBe(true);
  const rows = csv.text.slice(1).split("\r\n").filter(Boolean);
  expect(rows).toHaveLength(2);
  // The note is text in the JSON; in the CSV it gets an apostrophe in front, so a spreadsheet doesn't run it as a formula.
  expect(rows[1]).toMatch(/^\d{4}-\d{2}-\d{2},movie,Dune,,,\d{4},Export family,Bogdan,,'=ANA-NOTE-FOR-DUNE$/);

  // Bogdan's own file has his note, and nothing of Ana's. (He is asked how he liked Dune first.)
  await bogdanPage.goto("/app/settings");
  const ask = bogdanPage.getByRole("dialog", { name: "How did you like it?" });
  await expect(ask).toBeVisible();
  await ask.getByRole("button", { name: "Later" }).click();
  await expect(ask).toBeHidden();
  const his = await download(bogdanPage, "Everything (JSON)");
  expect(his.text).toContain("BOGDAN-SECRET-NOTE");
  for (const secret of ["ANA-NOTE-FOR-DUNE", ana.email, ana.id]) expect(his.text).not.toContain(secret);

  // The delete-account window points back to the download.
  await anaPage.getByRole("button", { name: "Delete account" }).click();
  await expect(anaPage.getByRole("link", { name: "Download your data" })).toBeVisible();
  await anaPage.getByRole("link", { name: "Download your data" }).click();
  await expect(anaPage.getByRole("button", { name: "Delete my account" })).toBeHidden();

  // The route itself, as someone with Ana's session, as a stranger, and as another site's page would reach it.
  const baseURL = testInfo.project.use.baseURL!;
  const mine = anaPage.context().request;
  const probe = (headers: Record<string, string> = {}, path = "/api/account/export") =>
    mine.get(`${baseURL}${path}`, { headers });
  expect((await probe({ "Sec-Fetch-Site": "cross-site" })).status()).toBe(403);
  expect((await probe({ "Sec-Fetch-Site": "same-site" })).status()).toBe(403);
  expect((await probe({}, "/api/account/export?format=xml")).status()).toBe(400);
  expect((await probe({}, "/api/account/export?format=json%0d%0aSet-Cookie:x=y")).status()).toBe(400);
  expect((await mine.post(`${baseURL}/api/account/export`)).status()).toBe(405);
  const stranger = await playwrightRequest.newContext({ baseURL });
  const signedOut = await stranger.get("/api/account/export");
  expect(signedOut.status()).toBe(401);
  expect(signedOut.headers()["content-disposition"]).toBeUndefined();
  await stranger.dispose();

  const typed = await probe({ "Sec-Fetch-Site": "none" });
  expect(typed.status()).toBe(200);
  expect(typed.headers()).toMatchObject({ "cache-control": "no-store", "x-content-type-options": "nosniff" });
  expect(typed.headers()["content-disposition"]).toMatch(/^attachment; filename="famflix-data-/);
  expect(typed.headers()["content-type"]).toContain("application/json");

  // Five an hour: the two files and the one above are three, two more go through and the next is told to wait, and so is
  // the button.
  expect((await probe({ "Sec-Fetch-Site": "same-origin" })).status()).toBe(200);
  expect((await probe()).status()).toBe(200);
  const limited = await probe();
  expect(limited.status()).toBe(429);
  expect(limited.headers()["retry-after"]).toBe("3600");
  await anaPage.reload();
  await anaPage.getByRole("button", { name: "Everything (JSON)" }).click();
  await expect(anaPage.locator("#download-data").getByRole("alert")).toContainText("a few times already");
  await Promise.all([anaPage, bogdanPage].map((page) => page.context().close()));
});
