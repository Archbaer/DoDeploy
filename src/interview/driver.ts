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
  readonly prompts: { kind: string; message: string; options?: string[] }[] = [];

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

  text(message = ""): Promise<string> {
    this.prompts.push({ kind: "text", message });
    return Promise.resolve(this.next<string>("text"));
  }

  select<T extends string>(message = "", options: SelectOption<T>[] = []): Promise<T> {
    this.prompts.push({ kind: "select", message, options: options.map((option) => option.value) });
    const value = this.next<T>("select");
    if (options.length > 0 && !options.some((option) => option.value === value)) {
      throw new Error(`ScriptedDriver: "${value}" was not offered for ${message}`);
    }
    return Promise.resolve(value);
  }

  confirm(message = ""): Promise<boolean> {
    this.prompts.push({ kind: "confirm", message });
    return Promise.resolve(this.next<boolean>("confirm"));
  }
}
