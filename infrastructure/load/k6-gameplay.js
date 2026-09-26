import http from "k6/http";
import { check, fail, sleep } from "k6";

export const options = {
  // A player authenticates once per VU, so its session cookie must survive
  // across iterations just as it does during a real browser session.
  noCookiesReset: true,
  summaryTrendStats: ["avg", "min", "med", "max", "p(90)", "p(95)", "p(99)"],
  stages: [
    { duration: __ENV.RAMP_DURATION ?? "30s", target: Number(__ENV.CONCURRENT_PLAYERS ?? 10) },
    { duration: __ENV.HOLD_DURATION ?? "2m", target: Number(__ENV.CONCURRENT_PLAYERS ?? 10) },
    { duration: __ENV.RAMP_DOWN_DURATION ?? "20s", target: 0 }
  ],
  thresholds: {
    checks: ["rate>0.99"],
    http_req_failed: ["rate<0.01"],
    "http_req_duration{name:game-start}": ["p(95)<500", "p(99)<1000"],
    "http_req_duration{name:game-action}": ["p(95)<500", "p(99)<1000"]
  }
};

const origin = __ENV.ORIGIN;
const password = __ENV.PLAYER_PASSWORD;
const wager = Number(__ENV.WAGER_CENTS ?? 10);
let authenticated = false;
let gameId = "";
const gameSlug = __ENV.GAME_SLUG ?? "neon-reels";

function authenticate() {
  const username = __ENV.PLAYER_USERNAME_PREFIX ? `${__ENV.PLAYER_USERNAME_PREFIX}${__VU}` : __ENV.PLAYER_USERNAME;
  if (!origin || !username || !password) fail("ORIGIN, PLAYER_PASSWORD, and either PLAYER_USERNAME or PLAYER_USERNAME_PREFIX are required");
  const login = http.post(`${origin}/api/v1/auth/login`, JSON.stringify({ username, password }), { headers: { "content-type": "application/json" }, tags: { name: "login" } });
  if (!check(login, { "player login succeeds": (response) => response.status === 200 })) fail(`Player login failed with status ${login.status}`);
  const catalog = http.get(`${origin}/api/v1/games`, { tags: { name: "catalog" } });
  if (!check(catalog, { "game catalog loads": (response) => response.status === 200 })) fail(`Game catalog failed with status ${catalog.status}`);
  const games = catalog.json("games");
  const game = Array.isArray(games) ? games.find((candidate) => candidate.slug === gameSlug) : null;
  if (!game?.id) fail(`${gameSlug} is not active in the game catalog`);
  gameId = game.id;
  authenticated = true;
}

function commandId(sequence) {
  const suffix = ((__VU * 1000000 + __ITER * 10 + sequence) % 0xffffffffffff).toString(16).padStart(12, "0");
  return `00000000-0000-4000-8000-${suffix}`;
}

export default function () {
  if (!authenticated) authenticate();
  const idempotencyKey = `load-${__VU}-${__ITER}-${Date.now()}`;
  const startBody = gameSlug === "neon-mines" ? { entryAmount: wager, difficulty: __ENV.MINES_DIFFICULTY ?? "EASY" } : { entryAmount: wager };
  const spin = http.post(`${origin}/api/v1/games/${gameId}/sessions`, JSON.stringify(startBody), {
    headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
    tags: { name: "game-start" }
  });
  check(spin, {
    "game start succeeds": (response) => response.status === 200,
    "game start has expected status": (response) => response.status === 200 && response.json("session.status") === (gameSlug === "neon-mines" ? "ACTIVE" : "COMPLETED")
  });
  if (gameSlug === "neon-mines" && spin.status === 200) {
    const sessionId = spin.json("session.id");
    const selected = http.post(`${origin}/api/v1/game-sessions/${sessionId}/commands`, JSON.stringify({ commandId: commandId(1), sequence: 1, payload: { action: "SELECT_TILE", tile: (__VU + __ITER) % 25 } }), {
      headers: { "content-type": "application/json" }, tags: { name: "game-action" }
    });
    check(selected, { "Mines selection succeeds": (response) => response.status === 200 });
    if (selected.status === 200 && selected.json("session.status") === "ACTIVE") {
      const cashed = http.post(`${origin}/api/v1/game-sessions/${sessionId}/commands`, JSON.stringify({ commandId: commandId(2), sequence: 2, payload: { action: "CASH_OUT" } }), {
        headers: { "content-type": "application/json" }, tags: { name: "game-action" }
      });
      check(cashed, { "Mines cash-out completes": (response) => response.status === 200 && response.json("session.status") === "COMPLETED" });
    }
  }
  const wallet = http.get(`${origin}/api/v1/wallet`, { tags: { name: "wallet" } });
  check(wallet, { "wallet refresh succeeds": (response) => response.status === 200 });
  sleep(Number(__ENV.THINK_TIME_SECONDS ?? 1.45));
}
