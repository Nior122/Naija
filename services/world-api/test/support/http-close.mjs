/**
 * Closes an API server's HTTP listener the way the production shutdown does (src/index.ts): start closing the
 * listener, close idle keep-alive connections, and return a promise that settles when the listener has closed.
 *
 * `server.shutdown()` stops the world and the WebSocket server but does not close the HTTP listener. A test that
 * only calls `shutdown()` leaves the listener open, and the test process then never exits. Call this before
 * `shutdown()`, and await the returned promise after it.
 */
export function beginHttpClose(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
    server.closeIdleConnections();
  });
}
