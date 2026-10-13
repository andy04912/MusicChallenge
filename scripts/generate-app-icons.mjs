import { readFile, mkdir } from "node:fs/promises";
import sharp from "sharp";
import { fileURLToPath } from "node:url";

// Reuse the project's vinyl/buzzer mark; no third-party imagery or fonts.
const source = await readFile(
  new URL("../public/images/music-challenge-mark.svg", import.meta.url),
);
const output = new URL("../public/icons/", import.meta.url);
await mkdir(output, { recursive: true });
for (const [name, size] of [
  ["icon-192", 192],
  ["icon-512", 512],
  ["apple-touch-icon", 180],
  ["favicon-32", 32],
]) {
  await sharp(source)
    .resize(size, size)
    .flatten({ background: "#F5F1E8" })
    .png()
    .toFile(fileURLToPath(new URL(`${name}.png`, output)));
}
// Keep the complete symbol within the central mask-safe circle.
const center = await sharp(source).resize(320, 320).png().toBuffer();
await sharp({
  create: { width: 512, height: 512, channels: 4, background: "#C6275D" },
})
  .composite([{ input: center, left: 96, top: 96 }])
  .png()
  .toFile(fileURLToPath(new URL("maskable-512.png", output)));
const mark = source
  .toString()
  .replace(/<\?xml[^>]*>/, "")
  .replace("<svg ", '<svg x="84" y="194" width="242" height="242" ');
const cover = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
<rect width="1200" height="630" fill="#1C1C1F"/>
<rect x="0" y="0" width="18" height="630" fill="#EF83A8"/>
<circle cx="1100" cy="54" r="225" fill="none" stroke="#383237" stroke-width="40"/>
<circle cx="1100" cy="54" r="156" fill="none" stroke="#383237" stroke-width="2"/>
${mark}<g font-family="Arial, sans-serif">
<text x="380" y="240" font-size="20" fill="#EF83A8" letter-spacing="5">LISTEN. GUESS. WIN.</text>
<text x="376" y="320" font-size="62" font-weight="800" fill="#F5F3EE">Music Challenge</text>
<text x="380" y="383" font-size="24" fill="#D0C8CC">MANDOPOP / K-POP</text>
<text x="84" y="555" font-size="17" fill="#EF83A8" letter-spacing="3">ONE SECOND. YOUR SONG.</text>
</g></svg>`;
await sharp(Buffer.from(cover))
  .png()
  .toFile(fileURLToPath(new URL("social-cover.png", output)));
console.log(
  "Generated app icons, maskable icon, Apple touch icon and social cover.",
);
