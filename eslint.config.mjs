// @ts-check Let TS check this config file

import zotero from "@zotero-plugin/eslint-config";
import globals from "globals";

export default zotero({
  overrides: [
    {
      files: ["**/*.ts"],
      rules: {
        // Some files intentionally keep unused helpers and debug hooks.
        "@typescript-eslint/no-unused-vars": "off",
      },
    },
    {
      files: ["scripts/**/*.mjs"],
      languageOptions: {
        globals: {
          ...globals.node,
        },
      },
    },
  ],
});
