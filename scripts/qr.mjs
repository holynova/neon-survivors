/**
 * Generate the QR code used in the README for the GitHub Pages URL.
 *
 *   node scripts/qr.mjs <url> <out.png>
 */
import QRCode from 'qrcode';

const url = process.argv[2] ?? 'https://holynova.github.io/neon-survivors/';
const out = process.argv[3] ?? 'docs/qr.png';

await QRCode.toFile(out, url, {
  type: 'png',
  errorCorrectionLevel: 'M',
  margin: 1,
  width: 320,
  // dark modules on white: scans reliably in dark-mode viewers too
  color: { dark: '#0b0f1fff', light: '#ffffffff' },
});

console.log('qr for', url, '->', out);
