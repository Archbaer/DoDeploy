import figlet from "figlet";
import gradient from "gradient-string";

const BANNER_COLORS = ["#ff8a00", "#e52e71"] as const;

export function renderBanner(title = "DODEPLOY"): string {
  const ascii = figlet.textSync(title, { font: "Standard" });
  const colored = gradient([...BANNER_COLORS]).multiline(ascii);
  const tagline = "docker compose → terraform, for AWS · GCP · Azure";
  return `${colored}\n${tagline}`;
}
