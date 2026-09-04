import { build } from "esbuild";

await build({
  entryPoints: ["src/main.ts"],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "chrome120",
  outfile: "android-assets/games/dev.yougotserved.tap-race/dist/game.js",
});
