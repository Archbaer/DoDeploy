import { cancel, confirm, isCancel, select, text } from "@clack/prompts";
import type { InterviewDriver, SelectOption } from "./driver.js";

function bail(): never {
  cancel("Interview cancelled");
  // 130 = 128 + SIGINT: cancellation is not a successful generation, so
  // shell automation (`generate && next-command`) must not continue.
  process.exit(130);
}

/** Human-facing driver backed by @clack/prompts. */
export class ClackDriver implements InterviewDriver {
  async text(message: string, options?: { defaultValue?: string }): Promise<string> {
    const result = await text({
      message,
      ...(options?.defaultValue !== undefined
        ? { defaultValue: options.defaultValue, placeholder: options.defaultValue }
        : {}),
    });
    if (isCancel(result)) bail();
    return result;
  }

  async select<T extends string>(message: string, options: SelectOption<T>[]): Promise<T> {
    const result = await select<string>({
      message,
      options: options.map((o) => ({
        value: o.value,
        label: o.label,
        ...(o.hint !== undefined ? { hint: o.hint } : {}),
      })),
    });
    if (isCancel(result)) bail();
    return result as T;
  }

  async confirm(message: string, initialValue = true): Promise<boolean> {
    const result = await confirm({ message, initialValue });
    if (isCancel(result)) bail();
    return result;
  }
}
