import { defineConfig } from "@playwright/test";

/**
 * Tests of pure logic (unit/): no browser, no server and no database, so they run anywhere with
 * `npm run test:unit`. The browser tests (e2e/) have their own config.
 */
export default defineConfig({
  testDir: "unit",
  reporter: process.env.CI ? [["list"], ["github"]] : "list",
});
