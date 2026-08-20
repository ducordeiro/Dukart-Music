import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const projectRoot = path.resolve(import.meta.dirname, "..");
const fontPath = path.join(projectRoot, "public", "fonts", "Midstar_Personal_Use.otf");
const iconsDir = path.join(projectRoot, "public", "icons");
const fontData = (await fs.readFile(fontPath)).toString("base64");
const browser = await chromium.launch({
  headless: true,
  executablePath: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
});

async function renderIcon(fileName, size, maskable = false) {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  const inset = Math.round(size * (maskable ? 0.16 : 0.105));
  const border = Math.max(3, Math.round(size * 0.014));
  const fontSize = Math.round(size * (maskable ? 0.29 : 0.32));
  await page.setContent(`<!doctype html>
    <style>
      @font-face {
        font-family: Midstar;
        src: url(data:font/otf;base64,${fontData}) format("opentype");
      }
      * { box-sizing: border-box; }
      html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; }
      body {
        display: grid;
        place-items: center;
        background:
          radial-gradient(circle at 50% 38%, rgba(242, 138, 37, .27), transparent 43%),
          linear-gradient(145deg, #171717 0%, #080808 100%);
      }
      .mark {
        position: absolute;
        inset: ${inset}px;
        display: grid;
        place-items: center;
        border: ${border}px solid #f28a25;
        border-radius: 50%;
        box-shadow: 0 0 ${Math.round(size * 0.055)}px rgba(242, 138, 37, .3), inset 0 0 ${Math.round(size * 0.045)}px rgba(242, 138, 37, .12);
      }
      .letters {
        color: #fff;
        font-family: Midstar, cursive;
        font-size: ${fontSize}px;
        font-weight: 400;
        line-height: 1;
        letter-spacing: -0.075em;
        transform: translate(-0.035em, -0.015em);
        text-shadow: 0 ${Math.max(1, Math.round(size * 0.012))}px ${Math.round(size * 0.035)}px rgba(0, 0, 0, .72);
        white-space: nowrap;
      }
    </style>
    <div class="mark"><span class="letters">DK</span></div>`);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.join(iconsDir, fileName), type: "png", omitBackground: false });
  await page.close();
}

await fs.mkdir(iconsDir, { recursive: true });
await renderIcon("icon-192.png", 192);
await renderIcon("icon-512.png", 512);
await renderIcon("icon-maskable-512.png", 512, true);
await browser.close();
