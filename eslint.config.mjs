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
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Generated/vendored output that shouldn't be linted:
    "coverage/**",
    "packages/*/dist/**",
    // Copied from node_modules by `npm run sync:pdf-worker` (predev/prebuild).
    "public/pdf.worker.min.mjs",
    // Server fixture built fresh by packages/art-review's test suite.
    "packages/art-review/test/.srv/**",
    // Scratch SQLite DB / compiled test modules / fixture app dirs built by
    // the root test suite (npm test).
    "test/.db/**",
    "test/.build/**",
    "test/.tmp-backup/**",
    // Compiled CommonJS output built fresh by packages/art-review's
    // pretest step (scripts/build-test.sh).
    "packages/art-review/test/.build/**",
    // Vendored third-party EXR decoder (adapted from three.js), already
    // marked `@ts-nocheck` in the file itself — not our code to lint.
    "packages/art-review/src/server/vendor/**",
  ]),
  {
    // .cjs test files are plain CommonJS by design (Node's `--test` runner),
    // so `require()` is the correct import style here, not a mistake the
    // TypeScript-oriented rule should flag.
    files: ["**/*.cjs"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  {
    // The codebase's existing convention for "deliberately unused" —
    // destructured-and-discarded fields, interface-mandated but unused
    // parameters — is a leading underscore. Honor it instead of flagging it.
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          args: "after-used",
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
        },
      ],
    },
  },
]);

export default eslintConfig;
