import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const environment = readFileSync(new URL("../../.env", import.meta.url), "utf8");
const databaseUrlLine = environment.split(/\r?\n/u).find((line) => line.trimStart().startsWith("DATABASE_URL="));
if (databaseUrlLine === undefined) throw new Error("DATABASE_URL is missing from .env");
let databaseUrl = databaseUrlLine.slice(databaseUrlLine.indexOf("=") + 1).trim();
if (databaseUrl.startsWith('"') && databaseUrl.endsWith('"')) databaseUrl = JSON.parse(databaseUrl);
else if (databaseUrl.startsWith("'") && databaseUrl.endsWith("'")) databaseUrl = databaseUrl.slice(1, -1);

const url = new URL(databaseUrl);
const username = decodeURIComponent(url.username);
const database = decodeURIComponent(url.pathname.slice(1));
const password = decodeURIComponent(url.password);
if (username.length === 0 || database.length === 0 || password.length === 0) throw new Error("DATABASE_URL must include username, password, and database");
if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(username) || !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(database)) throw new Error("Unsafe database identifier in DATABASE_URL");

const quotedUsername = `"${username.replaceAll('"', '""')}"`;
const quotedPassword = `'${password.replaceAll("'", "''")}'`;
const result = spawnSync("docker", ["compose", "exec", "-T", "postgres", "psql", "-v", "ON_ERROR_STOP=1", "-U", username, "-d", database], {
  cwd: new URL("../../", import.meta.url),
  input: `ALTER ROLE ${quotedUsername} WITH PASSWORD ${quotedPassword};\n`,
  stdio: ["pipe", "inherit", "inherit"]
});

if (result.error !== undefined) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
console.log("Database role password synchronized with .env.");
