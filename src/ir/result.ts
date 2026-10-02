import type { Diagnostic } from "./schema.js";

export type Result<T> = { ok: true; value: T } | { ok: false; diagnostics: Diagnostic[] };

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function err(...diagnostics: Diagnostic[]): Result<never> {
  return { ok: false, diagnostics };
}

export function mapResult<T, U>(result: Result<T>, fn: (value: T) => U): Result<U> {
  return result.ok ? ok(fn(result.value)) : result;
}
