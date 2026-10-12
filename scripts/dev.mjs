import { spawn } from "node:child_process";
import { createServer } from "vite";

if (
  (process.env.ADMIN_PASSWORD || "").length < 16 ||
  process.env.ADMIN_PASSWORD === "replace-with-a-long-unique-password"
) {
  throw new Error(
    "Set ADMIN_PASSWORD in .env before starting the development servers.",
  );
}
let vite,
  stopping = false;
const api = spawn(process.execPath, ["--watch", "server.mjs"], {
  stdio: "inherit",
  env: {
    ...process.env,
    PORT: "8080",
    HOST: "127.0.0.1",
    NODE_ENV: "development",
    APP_ORIGIN: "http://127.0.0.1:8080",
  },
});
async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  api.kill();
  await vite?.close();
  process.exit(code);
}
api.on("exit", (code) => stop(code ?? 0));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => stop());
try {
  vite = await createServer();
  await vite.listen();
  vite.printUrls();
} catch (error) {
  console.error(error.message);
  await stop(1);
}
