import { expect, test } from "@playwright/test";

import { safeAvatarUrl } from "../src/lib/format";

test("Google's own photo addresses are loaded", () => {
  for (const url of [
    "https://lh3.googleusercontent.com/a/ACg8ocJ=s96-c",
    "https://lh6.googleusercontent.com/-abc/AAAAAAAAAAI/AAAAAAAAAAA/photo.jpg",
    "https://googleusercontent.com/photo.png",
  ]) {
    expect(safeAvatarUrl(url)).toBe(new URL(url).href);
  }
});

test("any other address shows the initials instead", () => {
  for (const url of [
    "https://attacker.example/p.gif",
    // An address that only looks like Google's.
    "https://googleusercontent.com.attacker.example/p.gif",
    "https://attacker.example/lh3.googleusercontent.com/p.gif",
    "https://evilgoogleusercontent.com/p.gif",
    "https://lh3.googleusercontent.com@attacker.example/p.gif",
    // Not https.
    "http://lh3.googleusercontent.com/p.gif",
    "//lh3.googleusercontent.com/p.gif",
    "javascript:alert(1)",
    "data:image/gif;base64,R0lGODlhAQABAAAAACw=",
    "ftp://lh3.googleusercontent.com/p.gif",
    // Not an address at all.
    "not a url",
    "",
  ]) {
    expect(safeAvatarUrl(url), url).toBeNull();
  }
});

test("a missing photo is none", () => {
  expect(safeAvatarUrl(null)).toBeNull();
  expect(safeAvatarUrl(undefined)).toBeNull();
});
