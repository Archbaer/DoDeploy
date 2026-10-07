import figlet from "figlet";
import gradient from "gradient-string";

const BANNER_COLORS = ["#ff8a00", "#e52e71"] as const;
// Width of the figlet "Standard" artwork — below this it would wrap mid-glyph.
const BANNER_WIDTH = 48;

export function renderBanner(
  title = "DODEPLOY",
  columns = process.stdout.columns ?? (Number(process.env.COLUMNS) || undefined),
): string {
  const tagline = "docker compose → terraform, for AWS · GCP · Azure";
  if (columns !== undefined && columns < BANNER_WIDTH) {
    return gradient([...BANNER_COLORS])(`${title} · docker compose → terraform`);
  }
  const ascii = figlet.textSync(title, { font: "Standard" });
  const colored = gradient([...BANNER_COLORS]).multiline(ascii);
  return `${colored}\n${tagline}`;
}
