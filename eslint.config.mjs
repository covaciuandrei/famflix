import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    // Browser-test build and reports (scripts/e2e.sh).
    ".next-e2e/**",
    "playwright-report/**",
    "test-results/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Generated video-tooling output and vendored runtime; authoring sources stay linted.
    "video/intro/.hyperframes/**",
    "video/intro/assets/gsap.min.js",
    "video/intro/assets/audio-levels.js",
  ]),
]);

export default eslintConfig;
