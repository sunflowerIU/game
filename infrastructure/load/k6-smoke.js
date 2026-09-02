import http from "k6/http";
import ws from "k6/ws";
import { check, sleep } from "k6";

export const options = {
  stages: [{ duration: "30s", target: 10 }, { duration: "2m", target: 50 }, { duration: "30s", target: 0 }],
  thresholds: { http_req_failed: ["rate<0.01"], http_req_duration: ["p(95)<500"], checks: ["rate>0.99"] }
};

const origin = __ENV.ORIGIN ?? "https://games.example.com";
const websocketOrigin = origin.replace(/^http/u, "ws");

export default function () {
  const health = http.get(`${origin}/health/ready`);
  check(health, { "ready is 200": (response) => response.status === 200 });
  const socket = ws.connect(`${websocketOrigin}/api/v1/game-socket`, {}, (connection) => connection.setTimeout(() => connection.close(), 1_000));
  check(socket, { "socket handshake is handled": (response) => response?.status === 101 || response?.status === 401 });
  sleep(1);
}
