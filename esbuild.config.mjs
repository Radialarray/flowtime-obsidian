import esbuild from "esbuild";
import process from "process";

const prod = process.argv[2] === "production";

const context = await esbuild.context({
	entryPoints: ["src/main.ts"],
	bundle: true,
	format: "cjs",
	target: "es2018",
	platform: "node",
	external: ["obsidian", "electron"],
	outfile: "dist/main.js",
	minify: prod,
	sourcemap: prod ? false : "inline",
});

if (prod) {
	await context.rebuild();
	process.exit(0);
} else {
	await context.watch();
	console.log("Watching for changes...");
}
