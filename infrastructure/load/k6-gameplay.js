import http from "k6/http";
import { check, fail, sleep } from "k6";

export const options = {
  stages: [
    { duration: __ENV.RAMP_DURATION ?? "30s", target: Number(__ENV.CONCURRENT_PLAYERS ?? 10) },
    { duration: __ENV.HOLD_DURATION ?? "2m", target: Number(__ENV.CONCURRENT_PLAYERS ?? 10) },
    { duration: "20s", target: 0 }
  ],
  thresholds: {
    checks: ["rate>0.99"],
    http_req_failed: ["rate<0.01"],
    "http_req_duration{name:spin}": ["p(95)<500", "p(99)<1000"]
  }
};

const origin = __ENV.ORIGIN;
const password = __ENV.PLAYER_PASSWORD;
const wager = Number(__ENV.WAGER_CENTS ?? 10);
let authenticated = false;
let gameId = "";

function authenticate() {
  const username = __ENV.PLAYER_USERNAME_PREFIX ? `${__ENV.PLAYER_USERNAME_PREFIX}${__VU}` : __ENV.PLAYER_USERNAME;
  if (!origin || !username || !password) fail("ORIGIN, PLAYER_PASSWORD, and either PLAYER_USERNAME or PLAYER_USERNAME_PREFIX are required");
  const login = http.post(`${origin}/api/v1/auth/login`, JSON.stringify({ username, password }), { headers: { "content-type": "application/json" }, tags: { name: "login" } });
  if (!check(login, { "player login succeeds": (response) => response.status === 200 })) fail(`Player login failed with status ${login.status}`);
  const catalog = http.get(`${origin}/api/v1/games`, { tags: { name: "catalog" } });
  if (!check(catalog, { "game catalog loads": (response) => response.status === 200 })) fail(`Game catalog failed with status ${catalog.status}`);
  const games = catalog.json("games");
  const neonReels = Array.isArray(games) ? games.find((game) => game.slug === "neon-reels") : null;
  if (!neonReels?.id) fail("Neon Reels is not active in the game catalog");
  gameId = neonReels.id;
  authenticated = true;
}

export default function () {
  if (!authenticated) authenticate();
  const idempotencyKey = `load-${__VU}-${__ITER}-${Date.now()}`;
  const spin = http.post(`${origin}/api/v1/games/${gameId}/sessions`, JSON.stringify({ entryAmount: wager }), {
    headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
    tags: { name: "spin" }
  });
  check(spin, {
    "spin succeeds": (response) => response.status === 200,
    "spin completes authoritatively": (response) => response.json("session.status") === "COMPLETED"
  });
  const wallet = http.get(`${origin}/api/v1/wallet`, { tags: { name: "wallet" } });
  check(wallet, { "wallet refresh succeeds": (response) => response.status === 200 });
  sleep(Number(__ENV.THINK_TIME_SECONDS ?? 1.45));
}
