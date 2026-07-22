import globals from "globals";

const sharedRules = {
  "no-unused-vars": ["warn", { args: "none", varsIgnorePattern: "^_" }],
  "no-var": "off",
  "prefer-const": "warn",
  "no-console": "off",
  eqeqeq: ["warn", "smart"],
  curly: ["warn", "multi-line"],
  "no-throw-literal": "warn",
  "prefer-promise-reject-errors": "warn",
};

export default [
  {
    files: ["assets/js/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "script",
      globals: globals.browser,
    },
    rules: {
      ...sharedRules,
      // 页面按顺序加载的传统脚本通过全局符号协作，无法逐文件静态解析。
      "no-undef": "off",
      "no-unused-vars": "off",
    },
  },
  {
    files: ["assets/js/**/*.module.js", "assets/js/**/*.entry.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: globals.browser,
    },
    rules: {
      ...sharedRules,
      "no-undef": "error",
    },
  },
  {
    files: ["functions/**/*.js", "tests/**/*.mjs"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.node,
        ...globals.serviceworker,
      },
    },
    rules: {
      ...sharedRules,
      "no-undef": "error",
    },
  },
];
