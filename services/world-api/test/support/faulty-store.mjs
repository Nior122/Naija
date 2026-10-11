/**
 * A WorldStoreLike wrapper for tests. It delegates to a real store (file or PostgreSQL) and can
 * (a) hold the next write until released, (b) fail the next write before it reaches the backend, or
 * (c) let the next write commit and then report failure (a lost response).
 *
 * The wrapper never changes what is persisted except through the wrapped store.
 */
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

  failNextWrite(message = "injected write failure") {
    this.failures.push({ mode: "fail", error: new Error(message) });
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
      throw failure.error;
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
