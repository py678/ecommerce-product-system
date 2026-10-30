import { readFile, writeFile } from "node:fs/promises";
import { parseEnv } from "node:util";

const root = new URL("../", import.meta.url);
const local = parseEnv(await readFile(new URL("backend/.env", root), "utf8"));
if (!local.DATABASE_URL) throw new Error("Configure backend/.env first");
const peer = new URL(local.DATABASE_URL);
if (!["localhost", "127.0.0.1", "[::1]"].includes(peer.hostname))
  throw new Error("This helper expects the local PostgreSQL database");
peer.hostname = "host.docker.internal";
try {
  await writeFile(
    new URL(".env.sync.local", root),
    `PEER_DATABASE_URL=${JSON.stringify(peer.href)}\n`,
    { flag: "wx", mode: 0o600 },
  );
  console.log("Created ignored .env.sync.local without printing credentials");
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  console.log("Existing .env.sync.local preserved");
}
