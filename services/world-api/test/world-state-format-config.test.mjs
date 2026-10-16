import assert from "node:assert/strict";
import { test } from "node:test";
import { parseWorldStateFormat } from "../dist/config.js";

/** NAIJA_WORLD_STATE_FORMAT (Decision 1 rollout guard): pretty by default, compact only when named explicitly. */

test("rollout guard config: the default is pretty when the variable is absent or blank", () => {
  assert.equal(parseWorldStateFormat({}), "pretty");
  assert.equal(parseWorldStateFormat({ NAIJA_WORLD_STATE_FORMAT: "   " }), "pretty");
});

test("rollout guard config: compact is used only when named explicitly", () => {
  assert.equal(parseWorldStateFormat({ NAIJA_WORLD_STATE_FORMAT: "compact" }), "compact");
  assert.equal(parseWorldStateFormat({ NAIJA_WORLD_STATE_FORMAT: " pretty " }), "pretty");
});

test("rollout guard config: an unknown value stops startup with a fixed message that does not echo it", () => {
  assert.throws(
    () => parseWorldStateFormat({ NAIJA_WORLD_STATE_FORMAT: "minified-secret-value" }),
    (error) => {
      assert.equal(error.message, "NAIJA_WORLD_STATE_FORMAT must be 'pretty' or 'compact'.");
      assert.ok(!error.message.includes("secret"));
      return true;
    },
  );
});
