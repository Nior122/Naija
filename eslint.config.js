import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["**/dist/**", "**/node_modules/**"],
  },
  ...tseslint.configs.recommended,
  {
    files: ["services/world-api/src/**/*.ts"],
    rules: {
      "no-console": "off",
    },
  },
);
