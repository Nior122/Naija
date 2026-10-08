import { createApiServer } from "./app.js";
import { readApiConfig } from "./config.js";

const { port } = readApiConfig();
const server = createApiServer();
server.listen(port, "0.0.0.0", () => {
  console.log(`Naija world API listening on 0.0.0.0:${port}`);
});
