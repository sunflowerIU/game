import type { AuthorizedPrincipal } from "@game-platform/auth";

export type GameStatus = "ACTIVE" | "DISABLED" | "MAINTENANCE" | "DEPRECATED";
export type GameType = "SINGLE_PLAYER" | "MULTIPLAYER";

export interface GameCatalogRecord {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly status: GameStatus;
  readonly gameType: GameType;
  readonly version: string;
  readonly minimumEntry: bigint;
  readonly maximumEntry: bigint;
  readonly configuration: Readonly<Record<string, unknown>>;
}

export interface GameCatalogRepository {
  listActiveGames(): Promise<readonly GameCatalogRecord[]>;
}

export class GameCatalogError extends Error {
  public constructor(public readonly code: "ACCESS_DENIED", message: string) { super(message); this.name = "GameCatalogError"; }
}

export class GameCatalogService {
  public constructor(private readonly repository: GameCatalogRepository, private readonly registry: GameRegistry) {}

  public async listGames(principal: AuthorizedPrincipal): Promise<readonly GameCatalogRecord[]> {
    if (principal.type !== "PLAYER") throw new GameCatalogError("ACCESS_DENIED", "Player game access required");
    return (await this.repository.listActiveGames()).filter((game) => this.registry.has(game.slug, game.version));
  }
}

export interface GameDefinition {
  readonly slug: string;
  readonly version: string;
  validateConfiguration(configuration: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>>;
  createEngine(context: { readonly sessionId: string; readonly participantIds: readonly string[]; readonly configuration: Readonly<Record<string, unknown>>; readonly entryAmount: bigint; readonly startedAt: Date }): ActiveGameEngine;
}

export interface GameEngineTransition {
  readonly publicState: unknown;
  readonly events: readonly unknown[];
  readonly complete: boolean;
  readonly authoritativeResult?: unknown;
}

export interface ActiveGameEngine {
  handleInput(context: { readonly actorId: string; readonly payload: unknown; readonly receivedAt: Date }): Promise<GameEngineTransition>;
  complete(receivedAt: Date): Promise<GameEngineTransition>;
  getPublicState(viewerId: string): unknown;
}

export class GameRegistry {
  readonly #definitions = new Map<string, GameDefinition>();

  public register(definition: GameDefinition): void {
    const key = gameKey(definition.slug, definition.version);
    if (this.#definitions.has(key)) throw new Error(`Game definition ${key} is already registered`);
    this.#definitions.set(key, definition);
  }
  public has(slug: string, version: string): boolean { return this.#definitions.has(gameKey(slug, version)); }
  public require(slug: string, version: string): GameDefinition {
    const definition = this.#definitions.get(gameKey(slug, version));
    if (definition === undefined) throw new Error(`Game definition ${gameKey(slug, version)} is not registered`);
    return definition;
  }
}

function gameKey(slug: string, version: string): string { return `${slug}@${version}`; }
