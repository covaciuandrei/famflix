import { expect, test } from "@playwright/test";

const introButtonName = "Watch intro with narration (25 seconds)";
const videoUrl = "/video/famflix-intro.mp4?v=concise-25-v4";

test("intro assets are public and the video supports range requests", async ({ request }) => {
  const video = await request.get("/video/famflix-intro.mp4", {
    headers: { Range: "bytes=0-1023" },
  });
  expect(video.status()).toBe(206);
  expect(video.headers()["content-type"]).toContain("video/mp4");
  expect(video.headers()["content-range"]).toMatch(/^bytes 0-1023\/\d+$/);
  expect((await video.body()).byteLength).toBe(1024);

  const captions = await request.get("/video/famflix-intro.vtt");
  expect(captions.ok()).toBe(true);
  expect(captions.headers()["content-type"]).toContain("text/vtt");
  const text = await captions.text();
  expect(text).toContain("Meet FamFlix, a home for everything you want to watch.");
  expect(text).toContain("save them to your own list,");
  expect(text).toContain("and mark them watched when you're done.");
  expect(text).toContain("share a list with family and friends,");
  expect(text).not.toContain("no narration");
});

test("the landing-page intro is opt-in and leaves signup available", async ({ page }) => {
  const videoRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/video/")) videoRequests.push(request.url());
  });

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/Less choosing\.\s*More watching\./);
  await expect(page.getByRole("link", { name: "Get started" })).toBeVisible();
  await expect(page.getByRole("button", { name: introButtonName })).toBeVisible();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.locator("video")).toHaveCount(0);
  expect(videoRequests).toEqual([]);
});

test("the intro plays a 25-second narrated landscape video with sound and captions", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: introButtonName }).click();
  const dialog = page.getByRole("dialog", { name: "Meet FamFlix" });
  await expect(dialog).toBeVisible();
  const video = dialog.locator("video");
  await expect(video).toHaveAttribute("controls", "");
  await expect(video).toHaveAttribute("playsinline", "");
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.readyState)).toBeGreaterThanOrEqual(2);

  const media = await video.evaluate((element: HTMLVideoElement) => ({
    duration: element.duration,
    width: element.videoWidth,
    height: element.videoHeight,
    muted: element.muted,
  }));
  expect(media.duration).toBeCloseTo(25, 2);
  expect(media.width).toBe(1920);
  expect(media.height).toBe(1080);
  expect(media.muted).toBe(false);
  await expect(video).toHaveAttribute("src", videoUrl);
  await expect(video).not.toHaveAttribute("autoplay");
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeGreaterThan(0);

  await video.evaluate((element: HTMLVideoElement) => {
    element.pause();
    element.textTracks[0].mode = "hidden";
  });
  await expect.poll(() =>
    video.evaluate((element: HTMLVideoElement) => element.textTracks[0].cues?.length),
  ).toBe(12);
  await expect(dialog.getByRole("alert")).toHaveCount(0);
});

test("the intro has a transcript and closing it releases playback", async ({ page }) => {
  await page.goto("/");
  const trigger = page.getByRole("button", { name: introButtonName });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Meet FamFlix" });
  await dialog.getByText("Read the intro transcript", { exact: true }).click();
  await expect(dialog.getByText("Meet FamFlix, a home", { exact: false })).toBeVisible();
  await expect(dialog.getByText("share a list with family and friends", { exact: false })).toBeVisible();
  await expect(dialog.getByText("The demo shows choosing My list in Add to…", { exact: false })).toBeVisible();
  await expect(dialog.getByText("Watched after Mark watched", { exact: false })).toBeVisible();
  await expect(dialog.getByText("fictional demo examples", { exact: false })).toBeVisible();
  await expect(dialog.getByRole("link", { name: "Download the video" })).toHaveAttribute(
    "href",
    videoUrl,
  );

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(page.locator("video")).toHaveCount(0);
  await expect(trigger).toBeFocused();

  await trigger.click();
  await expect(dialog.locator("video")).toHaveCount(1);
  await dialog.getByRole("button", { name: "Close intro" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator("video")).toHaveCount(0);

  await trigger.click();
  await page.mouse.click(2, 2);
  await expect(dialog).toBeHidden();
  await expect(page.locator("video")).toHaveCount(0);
});

test("a video load failure offers the transcript and download", async ({ page }) => {
  await page.route("**/video/famflix-intro.mp4*", (route) => route.abort());
  await page.goto("/");
  await page.getByRole("button", { name: introButtonName }).click();
  const dialog = page.getByRole("dialog", { name: "Meet FamFlix" });
  await expect(dialog.getByRole("alert")).toContainText("could not be loaded");
  await expect(dialog.getByRole("link", { name: "Download the video" })).toBeVisible();
  await dialog.getByText("Read the intro transcript", { exact: true }).click();
  await expect(dialog.getByText("Meet FamFlix, a home", { exact: false })).toBeVisible();
});

test("blocked audible playback offers an explicit play button", async ({ page }) => {
  await page.addInitScript(() => {
    const play = HTMLMediaElement.prototype.play;
    let blocked = false;
    HTMLMediaElement.prototype.play = function () {
      if (!blocked) {
        blocked = true;
        return Promise.reject(new DOMException("Playback needs another gesture", "NotAllowedError"));
      }
      return play.call(this);
    };
  });
  await page.goto("/");
  await page.getByRole("button", { name: introButtonName }).click();
  const dialog = page.getByRole("dialog", { name: "Meet FamFlix" });
  await expect(dialog.getByRole("status")).toContainText("Press Play to hear the intro");
  await dialog.getByRole("button", { name: "Play intro with sound" }).click();
  await expect.poll(() => dialog.locator("video").evaluate(
    (element: HTMLVideoElement) => !element.paused && !element.muted,
  )).toBe(true);
  await expect(dialog.getByRole("status")).toHaveCount(0);
  await expect(dialog.getByRole("alert")).toHaveCount(0);
});
