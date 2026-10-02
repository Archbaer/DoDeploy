export interface SelectOption<T> {
  value: T;
  label: string;
  hint?: string;
}

export interface InterviewDriver {
  text(message: string, options?: { defaultValue?: string }): Promise<string>;
  select<T extends string>(message: string, options: SelectOption<T>[]): Promise<T>;
  confirm(message: string, initialValue?: boolean): Promise<boolean>;
}

/**
 * Deterministic driver for tests and CI: replays a scripted queue of responses.
 */
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

  select<T extends string>(): Promise<T> {
    return Promise.resolve(this.next<T>("select"));
  }

  confirm(): Promise<boolean> {
    return Promise.resolve(this.next<boolean>("confirm"));
  }
}
