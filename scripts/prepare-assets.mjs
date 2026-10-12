import { mkdir } from "node:fs/promises";
import sharp from "sharp";
import { fileURLToPath } from "node:url";

// Encode the original generated photograph for web delivery. Keep the original
// image in artwork/ for future builds; do not change its composition or content.
await mkdir(new URL("../public/images/", import.meta.url), { recursive: true });
await sharp(
  fileURLToPath(new URL("../artwork/record-hero.png", import.meta.url)),
)
  .webp({ quality: 84 })
  .toFile(
    fileURLToPath(
      new URL("../public/images/record-hero.webp", import.meta.url),
    ),
  );
