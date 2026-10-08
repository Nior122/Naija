import { createServer, type ServerResponse } from "node:http";
import { worldDescriptor } from "./world.js";

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(body));
}

/** Creates the Stage 0 read-only HTTP API. No request can mutate world state. */
export function createApiServer() {
  return createServer((request, response) => {
    const pathname = new URL(request.url ?? "/", "http://localhost").pathname;

    if (request.method !== "GET") {
      response.setHeader("Allow", "GET");
      sendJson(response, 405, { error: "method_not_allowed" });
      return;
    }

    if (pathname === "/health") {
      sendJson(response, 200, { status: "ok", service: "world-api" });
      return;
    }

    if (pathname === "/api/v1/world") {
      sendJson(response, 200, worldDescriptor);
      return;
    }

    sendJson(response, 404, { error: "not_found" });
  });
}
