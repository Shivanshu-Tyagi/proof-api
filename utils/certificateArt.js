import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';

// The PNG is drawn on the server, and small hosts ship with no fonts at all. Point the renderer at the
// fonts bundled in assets/fonts so the download looks the same everywhere. This must run before the first render.
const fontDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'fonts');
const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'proof-fonts-'));
const configFile = path.join(configDir, 'fonts.conf');
fs.writeFileSync(configFile, `<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig>
  <dir>${fontDir}</dir>
  <cachedir>${configDir}</cachedir>
</fontconfig>
`);
process.env.FONTCONFIG_FILE = configFile;

const WIDTH = 1400;
const HEIGHT = 990;
const ROSE = '#d92b53';
const INK = '#1b1b22';
const MUTED = '#5b5f6b';

// Bundled Liberation fonts first. In a browser, where they are not installed, the Times, Helvetica and Courier
// look-alikes that follow have the same widths, so the artwork lays out identically.
const SERIF = "'Liberation Serif', 'Times New Roman', Times, serif";
const SANS = "'Liberation Sans', Helvetica, Arial, sans-serif";
const MONO = "'Liberation Mono', 'Courier New', Courier, monospace";

// One palette per level: main (borders, text accents), light (soft lines), dark (medal edge)
const PALETTES = {
  bronze: { main: '#a8642b', light: '#e8c4a0', dark: '#6b3f1d', label: 'Bronze' },
  silver: { main: '#818a99', light: '#e1e5ec', dark: '#4b5563', label: 'Silver' },
  gold: { main: '#b8860b', light: '#f3dd96', dark: '#7a5a06', label: 'Gold' },
  platinum: { main: '#587086', light: '#d9e4ee', dark: '#34495e', label: 'Platinum' },
  diamond: { main: '#2f78c0', light: '#c3e4ff', dark: '#1e4f8a', label: 'Diamond' },
};

const esc = (value) => String(value ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const fmtDate = (value) => new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

// A star with `points` tips, centred on (cx, cy)
const star = (cx, cy, outer, inner, points = 5) => Array.from({ length: points * 2 }, (_, i) => {
  const r = i % 2 === 0 ? outer : inner;
  const a = (Math.PI / points) * i - Math.PI / 2;
  return `${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`;
}).join(' ');

const corner = (p, transform) => `
  <g transform="${transform}" fill="none" stroke="${p.main}" stroke-linecap="round">
    <path d="M62 150 A88 88 0 0 1 150 62" stroke-width="2.5"/>
    <path d="M62 128 A66 66 0 0 1 128 62" stroke-width="1.5" opacity=".6"/>
    <circle cx="62" cy="62" r="5" fill="${p.main}" stroke="none"/>
  </g>`;

/**
 * The certificate as an SVG string.
 * data: { names: string[], level, number, issuedAt, kind?, subject?, dateLine?, isPublic? }
 * kind is 'relationship' (default) or 'milestone'; subject is the relationship or milestone title.
 * The public version never includes the relationship title or start date.
 */
export const certificateSvg = ({ names, level, number, issuedAt, kind = 'relationship', subject, dateLine, isPublic = false }) => {
  const p = PALETTES[level] ?? PALETTES.bronze;
  const people = (names?.length ? names : ['Certificate holders']).map(esc);

  const joined = people.join(' & ');
  const nameSize = Math.max(34, Math.min(72, Math.floor(1040 / (joined.length * 0.56))));
  // dx spaces the ampersand; renderers drop plain spaces at tspan edges
  const nameTspans = people
    .map((n, i) => (i === 0
      ? `<tspan>${n}</tspan>`
      : `<tspan dx="${Math.round(nameSize * 0.28)}" fill="${ROSE}" font-style="italic">&amp;</tspan><tspan dx="${Math.round(nameSize * 0.28)}">${n}</tspan>`))
    .join('');

  const milestone = kind === 'milestone';
  const heading = milestone ? 'of Achievement' : 'of Relationship';
  const verb = milestone ? 'have completed the milestone' : 'have made it official together in';
  const publicVerb = milestone ? 'have reached a milestone together' : 'have made it official together';
  const middleLine = isPublic ? publicVerb : verb;
  const publicFeatured = milestone ? 'A milestone, verified by Twogether' : 'A private relationship, verified by Twogether';
  const featured = isPublic ? publicFeatured : `“${esc(subject || (milestone ? 'a shared milestone' : 'their relationship'))}”`;
  const featuredSize = Math.max(28, Math.min(48, Math.floor(980 / (featured.length * 0.5))));
  const sinceLine = !isPublic && dateLine ? esc(dateLine) : '';

  return `<svg width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" xmlns="http://www.w3.org/2000/svg" role="img">
  <defs>
    <radialGradient id="paper" cx="50%" cy="42%" r="75%">
      <stop offset="0%" stop-color="#fffefb"/><stop offset="100%" stop-color="#faf5ea"/>
    </radialGradient>
    <linearGradient id="frame" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${p.light}"/><stop offset="45%" stop-color="${p.main}"/><stop offset="100%" stop-color="${p.dark}"/>
    </linearGradient>
    <linearGradient id="medal" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${p.light}"/><stop offset="100%" stop-color="${p.main}"/>
    </linearGradient>
  </defs>

  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#paper)"/>

  <!-- Frame -->
  <rect x="30" y="30" width="${WIDTH - 60}" height="${HEIGHT - 60}" rx="20" fill="none" stroke="url(#frame)" stroke-width="7"/>
  <rect x="52" y="52" width="${WIDTH - 104}" height="${HEIGHT - 104}" rx="10" fill="none" stroke="${p.light}" stroke-width="2"/>
  ${corner(p, '')}
  ${corner(p, `translate(${WIDTH} 0) scale(-1 1)`)}
  ${corner(p, `translate(0 ${HEIGHT}) scale(1 -1)`)}
  ${corner(p, `translate(${WIDTH} ${HEIGHT}) scale(-1 -1)`)}

  <!-- Brand: the mark (two interlocking circles) and the name, centred as a pair (the name is about 163 wide) -->
  <g transform="translate(${WIDTH / 2 - 112} 78)">
    <rect width="46" height="46" rx="13" fill="${ROSE}"/>
    <g fill="none" stroke="#fff" stroke-width="3.2"><circle cx="17.6" cy="23" r="9.6"/><circle cx="28.4" cy="23" r="9.6"/></g>
    <text x="62" y="35" font-family="${SANS}" font-size="36" font-weight="800" fill="${INK}" letter-spacing="-1">twogether</text>
  </g>
  <text x="${WIDTH / 2}" y="160" text-anchor="middle" font-family="${SANS}" font-size="14" font-weight="700" letter-spacing="5" fill="${MUTED}">A PRIVATE RECORD FOR TWO</text>

  <!-- Title -->
  <text x="${WIDTH / 2}" y="232" text-anchor="middle" font-family="${SERIF}" font-size="30" font-weight="700" letter-spacing="14" fill="${p.dark}">CERTIFICATE</text>
  <text x="${WIDTH / 2}" y="304" text-anchor="middle" font-family="${SERIF}" font-size="68" font-style="italic" fill="${INK}">${heading}</text>
  <g stroke="${p.main}" stroke-width="2">
    <line x1="${WIDTH / 2 - 230}" y1="338" x2="${WIDTH / 2 - 22}" y2="338"/>
    <line x1="${WIDTH / 2 + 22}" y1="338" x2="${WIDTH / 2 + 230}" y2="338"/>
  </g>
  <rect x="${WIDTH / 2 - 8}" y="330" width="16" height="16" transform="rotate(45 ${WIDTH / 2} 338)" fill="${p.main}"/>

  <!-- Who -->
  <text x="${WIDTH / 2}" y="392" text-anchor="middle" font-family="${SERIF}" font-size="23" font-style="italic" fill="${MUTED}">This certifies that</text>
  <text x="${WIDTH / 2}" y="${470 + (72 - nameSize) / 4}" text-anchor="middle" font-family="${SERIF}" font-size="${nameSize}" font-weight="700" fill="${INK}">${nameTspans}</text>
  <line x1="${WIDTH / 2 - 380}" y1="498" x2="${WIDTH / 2 + 380}" y2="498" stroke="${p.light}" stroke-width="2"/>

  <!-- What -->
  <text x="${WIDTH / 2}" y="552" text-anchor="middle" font-family="${SERIF}" font-size="23" font-style="italic" fill="${MUTED}">${middleLine}</text>
  <text x="${WIDTH / 2}" y="612" text-anchor="middle" font-family="${SERIF}" font-size="${featuredSize}" font-style="italic" fill="${isPublic ? INK : p.dark}">${featured}</text>
  ${sinceLine ? `<text x="${WIDTH / 2}" y="660" text-anchor="middle" font-family="${SANS}" font-size="19" font-weight="600" fill="${MUTED}">${sinceLine}</text>` : ''}

  <!-- Medal -->
  <g transform="translate(${WIDTH / 2} 762)">
    <path d="M-34 40 L-62 128 L-30 114 L-12 140 L6 46 Z" fill="${p.dark}"/>
    <path d="M34 40 L62 128 L30 114 L12 140 L-6 46 Z" fill="${p.main}"/>
    <circle r="68" fill="url(#medal)" stroke="${p.dark}" stroke-width="4"/>
    <circle r="56" fill="none" stroke="#ffffff" stroke-width="2" stroke-dasharray="3 6" opacity=".8"/>
    <polygon points="${star(0, -16, 22, 9)}" fill="#ffffff" stroke="${p.dark}" stroke-width="1.5" stroke-linejoin="round"/>
    <text y="34" text-anchor="middle" font-family="${SANS}" font-size="13" font-weight="800" letter-spacing="2" fill="${p.dark}">${esc(p.label.toUpperCase())}</text>
  </g>

  <!-- Issued and number -->
  <g stroke="${p.light}" stroke-width="2"><line x1="170" y1="822" x2="450" y2="822"/><line x1="${WIDTH - 450}" y1="822" x2="${WIDTH - 170}" y2="822"/></g>
  <text x="310" y="852" text-anchor="middle" font-family="${SANS}" font-size="13" font-weight="700" letter-spacing="4" fill="${MUTED}">ISSUED</text>
  <text x="310" y="888" text-anchor="middle" font-family="${SERIF}" font-size="26" font-weight="700" fill="${INK}">${esc(fmtDate(issuedAt))}</text>
  <text x="${WIDTH - 310}" y="852" text-anchor="middle" font-family="${SANS}" font-size="13" font-weight="700" letter-spacing="4" fill="${MUTED}">CERTIFICATE NO.</text>
  <text x="${WIDTH - 310}" y="886" text-anchor="middle" font-family="${MONO}" font-size="21" font-weight="700" fill="${INK}">${esc(number)}</text>

  <text x="${WIDTH / 2}" y="927" text-anchor="middle" font-family="${SANS}" font-size="13" fill="${MUTED}">A keepsake record made in Twogether. It is not a legal document.</text>
</svg>`;
}

// PNG for downloads, rendered from the same artwork
export const certificatePng = (data) => sharp(Buffer.from(certificateSvg(data)), { density: 144 }).png({ compressionLevel: 9 }).toBuffer();
