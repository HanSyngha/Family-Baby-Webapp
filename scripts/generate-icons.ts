/**
 * PWA 아이콘 생성 스크립트
 * 실행: npx tsx scripts/generate-icons.ts
 */
import sharp from 'sharp';
import path from 'path';

const SIZES = [192, 512];
const OUTPUT_DIR = path.resolve('public/icons');

// 땅콩 모양 아이콘 SVG (Apple-minimal blue gradient)
const svgIcon = (size: number) => `
<svg width="${size}" height="${size}" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#007AFF;stop-opacity:1" />
      <stop offset="100%" style="stop-color:#5856D6;stop-opacity:1" />
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="112" fill="url(#bg)"/>
  <text x="256" y="290" text-anchor="middle" font-family="-apple-system, sans-serif" font-size="220" font-weight="700" fill="white">🥜</text>
</svg>`;

async function main() {
  for (const size of SIZES) {
    const svg = Buffer.from(svgIcon(size));
    await sharp(svg)
      .resize(size, size)
      .png()
      .toFile(path.join(OUTPUT_DIR, `icon-${size}.png`));
    console.log(`Generated icon-${size}.png`);
  }
  console.log('Done!');
}

main().catch(console.error);
