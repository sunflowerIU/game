export class AppError extends Error {
  public constructor(
    public readonly code: string,
    public readonly statusCode: number,
    message: string
  ) {
    super(message);
    this.name = "AppError";
  }
}

