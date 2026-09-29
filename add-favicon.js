// Run once from the elimuos-app folder:  node add-favicon.js
// Adds the favicon + share-preview tags to every HTML page in public/.
const fs = require('fs'), path = require('path');
const SITE = process.env.SITE_URL || 'https://YOUR-DOMAIN.com'; // set your real domain
const tags = (depth) => {
  const p = depth ? '../'.repeat(depth) : '';
  return `<!-- favicon:start -->
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="icon" type="image/png" sizes="48x48" href="/favicon-48.png">
<link rel="icon" type="image/png" sizes="192x192" href="/favicon-192.png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<meta name="theme-color" content="#4A5AF0">
<!-- favicon:end -->`;
};
const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e =>
  e.isDirectory() ? (e.name === 'node_modules' ? [] : walk(path.join(d, e.name))) : e.name.endsWith('.html') ? [path.join(d, e.name)] : []);
for (const f of walk('public')) {
  let t = fs.readFileSync(f, 'utf8');
  t = t.replace(/<!-- favicon:start -->[\s\S]*?<!-- favicon:end -->\s*/g, '');
  const nl = t.includes('\r\n') ? '\r\n' : '\n';
  t = t.replace(/(<head[^>]*>)/i, `$1${nl}${tags().replace(/\n/g, nl)}`);
  fs.writeFileSync(f, t);
  console.log('updated', f);
}