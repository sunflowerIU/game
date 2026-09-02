import type { ApiErrorResponse } from "@game-platform/contracts";

const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";

export function apiUrl(path: string): string { return `${apiBaseUrl}${path}`; }

export class ApiClientError extends Error {
  public constructor(public readonly code: string, message: string, public readonly status: number) {
    super(message);
    this.name = "ApiClientError";
  }
}

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(apiUrl(path), {
    ...init,
    credentials: "include",
    headers: {
      ...(init.body === undefined ? {} : { "content-type": "application/json" }),
      ...init.headers
    }
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null) as ApiErrorResponse | null;
    throw new ApiClientError(
      payload?.error.code ?? "REQUEST_FAILED",
      payload?.error.message ?? "The request could not be completed",
      response.status
    );
  }

  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
