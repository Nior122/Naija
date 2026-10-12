/**
 * A WorldStoreLike wrapper for tests. It delegates to a real store (file or PostgreSQL) and can
 * (a) hold the next write until released, (b) fail the next write before it reaches the backend, or
 * (c) let the next write commit and then report failure (a lost response).
 *
 * The wrapper never changes what is persisted except through the wrapped store.
 */
import { markSaveOutcome } from "../../dist/persistence-status.js";

export class FaultyStore {
  constructor(inner) {
    this.inner = inner;
    this.failures = [];
    this.hold = null;
    this.holdAfter = null;
    this.writeCount = 0;
    this.committedCount = 0;
    this.heldCount = 0;
    this.killed = false;
  }

  /**
   * Simulates a process that has died: from now on no write reaches the storage, including the saves that a closing
   * socket would otherwise trigger. Used by crash tests, so an abandoned server cannot save its unsaved state.
   */
  kill() {
    this.killed = true;
  }

  get state() {
    return this.inner.state;
  }

  get filePath() {
    return this.inner.filePath;
  }

  /** Health comes from the wrapped store, so injected failures show up exactly as real ones do (G1). */
  health() {
    return this.inner.health();
  }

  /** Forwards the wrapped store's fence state, so the engine's treasury gate sees the same answer as in production. */
  isFenced() {
    return this.inner.isFenced?.() === true;
  }

  failNextWrite(message = "injected write failure") {
    this.failures.push({ mode: "fail", error: new Error(message) });
  }

  /** Removes every queued failure, so the next save reaches the wrapped store again. */
  clearFailures() {
    this.failures = [];
  }

  failNextWriteAfterCommit(message = "injected response loss") {
    this.failures.push({ mode: "commit-then-fail", error: new Error(message) });
  }

  /** The next write waits until the returned function is called. */
  holdNextWrite() {
    let release = () => {};
    this.hold = new Promise((resolve) => {
      release = resolve;
    });
    return release;
  }

  /** The next write commits, then waits until the returned function is called (a process can be killed here). */
  holdNextWriteAfterCommit() {
    let release = () => {};
    this.holdAfter = new Promise((resolve) => {
      release = resolve;
    });
    return release;
  }

  flush() {
    return this.#write(() => this.inner.flush());
  }

  saveState(candidate) {
    return this.#write(() => this.inner.saveState(candidate));
  }

  /**
   * Stage 36: durable request records are forwarded unchanged. They are written by the wrapped store's save, so a
   * record is never written by this wrapper directly, and a fault injected here applies to the whole save.
   */
  queueOperation(record) {
    this.inner.queueOperation?.(record);
  }

  findOperation(playerId, requestId) {
    return this.inner.findOperation ? this.inner.findOperation(playerId, requestId) : Promise.resolve(undefined);
  }

  async #write(perform) {
    this.writeCount += 1;
    if (this.killed) throw new Error("the process has stopped");
    const failure = this.failures.shift();
    const gate = this.hold;
    this.hold = null;
    if (gate) {
      this.heldCount += 1;
      await gate;
    }
    if (failure?.mode === "fail") {
      // An injected failure never reaches the wrapped store, so record it there, as a real failed save would be.
      this.inner.saveStatus?.recordFailure("error", Date.now());
      // Failed before the wrapped store was touched, so the saved world is unchanged: "not_saved" (Stage 33).
      throw markSaveOutcome(failure.error, "not_saved");
    }
    await perform();
    this.committedCount += 1;
    const after = this.holdAfter;
    this.holdAfter = null;
    if (after) await after;
    if (failure?.mode === "commit-then-fail") throw failure.error;
  }
}

export async function waitUntil(predicate, timeoutMs = 4000, intervalMs = 5) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error("Timed out waiting for a test condition.");
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
