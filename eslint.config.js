/** @type {import('eslint').Linter.Config[]} */
module.exports = [
	{
		files: ["src/**/*.js"],
		languageOptions: {
			ecmaVersion: 2022,
			globals: {
				require: "readonly",
				module: "readonly",
				exports: "readonly",
				__dirname: "readonly",
				console: "readonly",
				setTimeout: "readonly",
				clearTimeout: "readonly",
				setInterval: "readonly",
				clearInterval: "readonly",
				AudioContext: "readonly",
				process: "readonly",
				document: "readonly",
				window: "readonly",
				Blob: "readonly",
			},
		},
		rules: {
			"no-undef": "error",
			"no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
		},
	},
];
