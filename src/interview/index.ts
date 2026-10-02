import type { Diagnostic, EnrichedIR, ProjectIR, Recommendation } from "../ir/index.js";

export interface SelectOption<T> {
  value: T;
  label: string;
  hint?: string;
}

export interface InterviewDriver {
  text(message: string, options?: { defaultValue?: string }): Promise<string>;
  select<T>(message: string, options: SelectOption<T>[]): Promise<T>;
  confirm(message: string, initialValue?: boolean): Promise<boolean>;
}

export type InterviewResult =
  | { ok: true; value: ProjectIR; diagnostics: Diagnostic[] }
  | { ok: false; diagnostics: Diagnostic[] };

export class ScriptedDriver implements InterviewDriver {
  private queue: unknown[];

  constructor(responses: unknown[]) {
    this.queue = [...responses];
  }

  exhausted(): boolean {
    return this.queue.length === 0;
  }

  private next<T>(kind: string): T {
    const value = this.queue.shift();
    if (value === undefined) {
      throw new Error(`ScriptedDriver: no scripted response left for ${kind}`);
    }
    return value as T;
  }

  text(): Promise<string> {
    return Promise.resolve(this.next<string>("text"));
  }

  select<T>(): Promise<T> {
    return Promise.resolve(this.next<T>("select"));
  }

  confirm(): Promise<boolean> {
    return Promise.resolve(this.next<boolean>("confirm"));
  }
}

export async function runInterview(
  _ir: ProjectIR,
  _driver: InterviewDriver,
): Promise<InterviewResult> {
  throw new Error("not implemented");
}

export async function acceptRecommendations(
  _enriched: EnrichedIR,
  _driver: InterviewDriver,
): Promise<Recommendation[]> {
  throw new Error("not implemented");
}
