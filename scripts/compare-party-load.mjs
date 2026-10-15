import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { benchmarkSongs } from "./party-benchmark-fixture.mjs";

const args = Object.fromEntries(
  process.argv.slice(2).map((s) => s.replace(/^--/, "").split("=")),
);
if (!args.before)
  throw new Error("--before=path-to-baseline-checkout is required");
const root = process.cwd(),
  output = resolve(args.out || `data/party-comparison-${Date.now()}`);
// Never reopen an existing directory: the fixture seeding below replaces its
// songs table, so each comparison must own a newly created output directory.
await mkdir(dirname(output), { recursive: true });
await mkdir(output);
const summary = [];
for (const [name, source, compact] of [
  ["before", resolve(args.before), 0],
  ["after", root, 1],
]) {
  const dir = resolve(output, name);
  await mkdir(dir, { recursive: true });
  const child = spawn(process.execPath, [resolve(source, "server.mjs")], {
    cwd: source,
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: "0",
      DATA_DIR: dir,
      NODE_ENV: "test",
      SERVE_STATIC: "false",
      APP_ORIGIN: "",
      ADMIN_PASSWORD: "isolated-load-benchmark-only",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let errors = "";
  child.stderr.on("data", (s) => (errors += s));
  try {
    const origin = await new Promise((yes, no) => {
      let text = "";
      const timer = setTimeout(
        () => no(new Error("Server startup timeout " + errors)),
        10000,
      );
      child.stdout.on("data", (s) => {
        text += s;
        const match = text.match(/Local: (http:\/\/127\.0\.0\.1:\d+)/);
        if (match) {
          clearTimeout(timer);
          yes(match[1]);
        }
      });
      child.once("exit", () => {
        clearTimeout(timer);
        no(new Error(errors));
      });
    });
    const db = new DatabaseSync(resolve(dir, "songs.sqlite"));
    const columns = Object.keys(benchmarkSongs[0]);
    const add = db.prepare(
      `INSERT INTO songs (${columns.join(",")},status,categoryReview) VALUES (${columns.map(() => "?").join(",")},'published',0)`,
    );
    db.exec("BEGIN; DELETE FROM songs;");
    for (const s of benchmarkSongs) add.run(...columns.map((k) => s[k]));
    db.exec("COMMIT");
    db.close();
    console.log(
      `${name}: isolated 558-song catalog, 2 full parties, compact=${compact}`,
    );
    const load = spawn(
      process.execPath,
      [
        resolve(root, "scripts/load-test.mjs"),
        `--origin=${origin}`,
        "--confirm=live-load-test",
        "--rooms=2",
        "--bursts=3",
        `--compact=${compact}`,
        `--out=${resolve(dir, "load")}`,
      ],
      { cwd: root, stdio: "inherit" },
    );
    const [code] = await once(load, "exit");
    if (code !== 0) throw new Error(`Load script exited ${code}`);
    const report = JSON.parse(
      await readFile(resolve(dir, "load/report.json"), "utf8"),
    );
    const inspect = new DatabaseSync(resolve(dir, "songs.sqlite"), {
      readOnly: true,
    });
    const stateBytes = inspect
      .prepare(
        "SELECT avg(length(CAST(value AS BLOB))) AS bytes FROM game_states WHERE kind='party'",
      )
      .get().bytes;
    inspect.close();
    if (
      report.stopReason ||
      report.cleanup.some((r) => r.status !== "finished")
    )
      throw new Error("Load run stopped: " + report.stopReason);
    summary.push({
      name,
      compact,
      fixtureSongs: 558,
      meanPersistedStateBytes: stateBytes,
      ...report,
    });
  } finally {
    if (child.exitCode === null) {
      const exited = once(child, "exit");
      child.kill();
      await exited;
    }
  }
}
await writeFile(
  resolve(output, "comparison.json"),
  JSON.stringify(summary, null, 2),
);
console.log("Comparison saved: " + resolve(output, "comparison.json"));
