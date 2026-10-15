# Live capacity probes

Run only against a deployment you own and intend to load. The script creates persistent test player identities and party rooms. It finishes its rooms on exit but preserves their database records. It does not download Apple audio, create share receipts, or add leaderboard scores.

```powershell
node scripts/load-test.mjs --origin=https://music-challenge.zeabur.app --confirm=live-load-test --rooms=1,2,4,8 --out=data/load-test-run
```

Each room contains 50 independent players and one host, each with its own SSE connection. Stages include 20 seconds of idle connections, 30 seconds of mixed traffic (60% deliberately wrong guesses, 20% catalog reads, 20% leaderboard reads), and concurrent all-member updates. Give-up actions exercise room-wide fan-out without fabricating correct scores. The generator never loads the music previews.

- `--profile=idle` tests connections and health probes only, after creating/starting the rooms.
- `--profile=fanout` skips the mixed traffic, retaining idle and broadcast phases.
- `--compact=1` opts into the new party delta stream; the default remains legacy full snapshots for an explicit baseline.
- `--bursts=3` repeats the fan-out wave three times (maximum five).
- Room counts may be repeated to repeat a stage, and must be between 1 and 16.
- Output contains `events.jsonl` and `report.json`, with latency in milliseconds.
- `cleanup-private.json` contains **test identity cookies** for recovery. Keep it private under ignored `data/`; do not commit or share it. Recovery must read the current room/round before finishing it.
- Creating a `STOP` file inside the output directory asks the generator to stop and finish its rooms. Ctrl+C also requests cleanup.

Automatic stops include failed/stale SSE streams, health failures, health p95 over 1.5 seconds, recent request failures above 1%, request p95 over 1.5 seconds, broadcast p95 over 1.5 seconds, more than 50 pending load requests, or a 12-minute runtime limit. Resource telemetry is sampled separately through Zeabur; the operator can write `STOP` if whole-server CPU exceeds 80% or memory exceeds 85%. These are conservative test guardrails, not product SLAs.

Latencies include the load generator's network path. Broadcast latency measures time from sending an action until all room clients observe its revision or a newer one. A single-machine test cannot separate server egress, Internet transit, and the generator's access bandwidth. This is a bounded probe, not a long-duration or distributed capacity certification. Idle connections, active gameplay, frontend rendering, and Apple CDN delivery are different workloads.

## Isolated version comparison

`node scripts/compare-party-load.mjs --before=path-to-old-checkout --out=data/comparison-unique-name` runs both servers sequentially on localhost with independent SQLite databases, the same 558 synthetic songs, 102 SSE clients, 20 requests/sec for 30 seconds, and three fan-out waves. The old server uses full snapshots; the current server uses compact streams. It stops both servers after finishing the rooms and writes `comparison.json`. Use a new output directory per run. It never seeds or changes the production database. Local filesystem and loopback timings cannot be used as production latency predictions.
