export interface DoctorCheck {
  id: string;
  label: string;
  ok: boolean;
  /** Critical failures make `dodeploy doctor` exit non-zero. */
  critical: boolean;
  detail: string;
}

export interface DoctorOptions {
  composePath?: string;
}

export function runDoctor(_options: DoctorOptions): DoctorCheck[] {
  throw new Error("not implemented");
}
