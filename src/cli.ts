import { Command } from "commander";
import { renderBanner } from "./ui/banner.js";

const VERSION = "0.1.0";

export function buildProgram(): Command {
  const program = new Command();
  program
    .name("dodeploy")
    .description("Turn a docker-compose.yaml into deployable Terraform for AWS, GCP and Azure")
    .version(VERSION);

  program.addCommand(
    new Command("analyze")
      .description("Parse a compose file and report findings + recommendations (stub)")
      .argument("[path]", "path to docker-compose.yaml", "docker-compose.yaml")
      .action(() => {
        console.log("analyze: coming in Phase 2");
      }),
  );

  program.addCommand(
    new Command("generate")
      .description("Run the interview and render Terraform (stub)")
      .option("-o, --out <dir>", "output directory", "dodeploy-infra")
      .action(() => {
        console.log("generate: coming in Phase 6");
      }),
  );

  return program;
}

export function run(argv: string[]): void {
  const program = buildProgram();
  if (argv.length <= 2) {
    console.log(renderBanner());
    program.outputHelp();
    return;
  }
  program.parse(argv);
}
