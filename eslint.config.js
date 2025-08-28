const tseslint = require('typescript-eslint');
const globals = require('globals');

module.exports = [
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: {
      // You can add custom rules here if needed
    },
  },
  {
    ignores: ["out/", "node_modules/", "dist/", "build/"],
  }
];
