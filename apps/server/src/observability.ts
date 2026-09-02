import type { FastifyInstance } from "fastify";

const DURATION_BUCKETS = [5, 10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000] as const;

class DurationHistogram {
  readonly #buckets = DURATION_BUCKETS.map(() => 0);
  #count = 0;
  #sum = 0;

  public observe(durationMilliseconds: number): void {
    this.#count += 1;
    this.#sum += durationMilliseconds;
    DURATION_BUCKETS.forEach((boundary, index) => { if (durationMilliseconds <= boundary) this.#buckets[index] = (this.#buckets[index] ?? 0) + 1; });
  }

  public render(name: string, help: string): string[] {
    return [
      `# HELP ${name} ${help}`,
      `# TYPE ${name} histogram`,
      ...DURATION_BUCKETS.map((boundary, index) => `${name}_bucket{le="${boundary}"} ${this.#buckets[index] ?? 0}`),
      `${name}_bucket{le="+Inf"} ${this.#count}`,
      `${name}_sum ${this.#sum.toFixed(3)}`,
      `${name}_count ${this.#count}`
    ];
  }
}

export class OperationalMetrics {
  readonly #startedAt = Date.now();
  #requests = 0;
  #errors = 0;
  #durationMilliseconds = 0;
  readonly #requestDurations = new DurationHistogram();
  readonly #spinDurations = new DurationHistogram();

  public observe(statusCode: number, durationMilliseconds: number, spinRequest = false): void {
    this.#requests += 1;
    this.#durationMilliseconds += durationMilliseconds;
    this.#requestDurations.observe(durationMilliseconds);
    if (spinRequest) this.#spinDurations.observe(durationMilliseconds);
    if (statusCode >= 500) this.#errors += 1;
  }

  public render(): string {
    const memory = process.memoryUsage();
    return [
      "# HELP game_platform_uptime_seconds Process uptime.",
      "# TYPE game_platform_uptime_seconds gauge",
      `game_platform_uptime_seconds ${Math.floor((Date.now() - this.#startedAt) / 1_000)}`,
      "# HELP game_platform_http_requests_total Completed HTTP requests.",
      "# TYPE game_platform_http_requests_total counter",
      `game_platform_http_requests_total ${this.#requests}`,
      "# HELP game_platform_http_errors_total Completed HTTP requests with a 5xx response.",
      "# TYPE game_platform_http_errors_total counter",
      `game_platform_http_errors_total ${this.#errors}`,
      "# HELP game_platform_http_request_duration_milliseconds_total Cumulative request duration.",
      "# TYPE game_platform_http_request_duration_milliseconds_total counter",
      `game_platform_http_request_duration_milliseconds_total ${this.#durationMilliseconds.toFixed(3)}`,
      ...this.#requestDurations.render("game_platform_http_request_duration_milliseconds", "Completed HTTP request duration in milliseconds."),
      ...this.#spinDurations.render("game_platform_spin_request_duration_milliseconds", "Completed paid game-spin request duration in milliseconds."),
      "# HELP game_platform_process_resident_memory_bytes Resident process memory.",
      "# TYPE game_platform_process_resident_memory_bytes gauge",
      `game_platform_process_resident_memory_bytes ${memory.rss}`,
      ""
    ].join("\n");
  }
}

export function registerObservability(app: FastifyInstance, metrics: OperationalMetrics = new OperationalMetrics()): void {
  app.get("/internal/metrics", async (_request, reply) => reply.type("text/plain; version=0.0.4; charset=utf-8").send(metrics.render()));
  app.addHook("onResponse", async (request, reply) => {
    if (request.url === "/internal/metrics") return;
    const spinRequest = request.method === "POST" && request.routeOptions.url === "/api/v1/games/:gameId/sessions";
    metrics.observe(reply.statusCode, reply.elapsedTime, spinRequest);
    const parameters = request.params as Record<string, unknown>;
    request.log.info({
      event: "request_summary",
      accountId: request.principal?.accountId,
      authSessionId: request.principal?.sessionId,
      gameId: typeof parameters.gameId === "string" ? parameters.gameId : undefined,
      gameSessionId: typeof parameters.sessionId === "string" ? parameters.sessionId : undefined,
      statusCode: reply.statusCode,
      durationMilliseconds: reply.elapsedTime
    }, "request completed");
  });
}
