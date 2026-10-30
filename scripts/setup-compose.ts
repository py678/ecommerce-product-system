import { randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";

// Hex secrets are safe inside DATABASE_URL and Compose interpolation.
const secret = () => randomBytes(32).toString("hex");
try {
  await writeFile(
    new URL("../.env", import.meta.url),
    `POSTGRES_PASSWORD=${secret()}\nAPP_PASSWORD=${secret()}\nJWT_SECRET=${secret()}\nWEB_PORT=8088\n`,
    { flag: "wx", mode: 0o600 },
  );
  console.log(
    "Created ignored root .env for Compose. Existing backend/.env is unchanged.",
  );
} catch (error) {
  if ((error as NodeJS.ErrnoException).code === "EEXIST") {
    console.log("Root .env already exists; kept existing credentials.");
  } else {
    throw error;
  }
}
