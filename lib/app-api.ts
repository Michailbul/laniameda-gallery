"use client";

type QueryValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | Array<string | number | boolean>;

type QueryParams = Record<string, QueryValue>;

const DEFAULT_ERROR_MESSAGE = "Request failed.";

export function buildQueryString(params: QueryParams) {
  const searchParams = new URLSearchParams();

  for (const [key, rawValue] of Object.entries(params)) {
    if (rawValue === undefined || rawValue === null || rawValue === "") {
      continue;
    }

    if (Array.isArray(rawValue)) {
      for (const item of rawValue) {
        searchParams.append(key, String(item));
      }
      continue;
    }

    searchParams.set(key, String(rawValue));
  }

  return searchParams.toString();
}

export async function requestJson<T>(
  input: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(input, init);
  const payload = (await response.json().catch(() => null)) as
    | { error?: string }
    | null;

  if (!response.ok) {
    throw new Error(payload?.error || DEFAULT_ERROR_MESSAGE);
  }

  return payload as T;
}
