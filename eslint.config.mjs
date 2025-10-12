import js from "@eslint/js";
import globals from "globals";
import tseslint from "@typescript-eslint/eslint-plugin";
import json from "@eslint/json";
import markdown from "@eslint/markdown";
import css from "@eslint/css";

export default [
  // JavaScript recommended rules from @eslint/js
  { files: ["**/*.{js,mjs,cjs,ts,mts,cts}"], plugins: { js }, languageOptions: { globals: { ...globals.browser, d3: 'readonly', topojson: 'readonly' } }, rules: { 'no-empty': 'off', 'no-unused-vars': 'off' }, ...js.configs.recommended },
  // TypeScript recommended flat config from @typescript-eslint
  ...(tseslint.flatConfigs && tseslint.flatConfigs['flat/recommended'] ? tseslint.flatConfigs['flat/recommended'] : []),
  // JSON/Markdown/CSS configs - include recommended rules directly
  { files: ["**/*.json"], plugins: { json }, language: "json/json", ...json.configs.recommended },
  { files: ["**/*.jsonc"], plugins: { json }, language: "json/jsonc", ...json.configs.recommended },
  { files: ["**/*.json5"], plugins: { json }, language: "json/json5", ...json.configs.recommended },
  { files: ["**/*.md"], plugins: { markdown }, language: "markdown/gfm", ...markdown.configs.recommended },
  { files: ["**/*.css"], plugins: { css }, language: "css/css", ...css.configs.recommended },
  // Ensure our migration helpers don't get flooded by unused-var/no-empty from other configs
  { files: ["**/*.{js,mjs,cjs,ts,mts,cts}"], rules: { 'no-empty': 'off', 'no-unused-vars': 'off', '@typescript-eslint/no-unused-vars': 'off', 'no-useless-escape': 'off' } }
];
