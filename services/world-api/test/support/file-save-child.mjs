// Test helper (Stage 28, G5). Saves a world to the file given as the argument, in a loop, and prints each completed
// save. The parent test kills it with SIGKILL at a random point. It writes only to the temporary directory it is given.
import { WorldStore } from "../../dist/multiplayer/persistence.js";

const file = process.argv[2];
if (!file) throw new Error("usage: file-save-child.mjs <world-file>");
const store = new WorldStore(file, Date.now());
const payload = "x".repeat(512 * 1024);
for (let n = 1; ; n += 1) {
  const state = structuredClone(store.state);
  state.lifeEvents["kill-record"] = {
    event_id: "kill-record",
    event_type: "character_created",
    world_date: state.worldClock.world_date,
    world_day: state.worldClock.day,
    minute_of_day: 0,
    participant_ids: [],
    summary: `kill ${n}`,
    data: { payload },
  };
  await store.saveState(state);
  process.stdout.write(`saved ${n}\n`);
}
