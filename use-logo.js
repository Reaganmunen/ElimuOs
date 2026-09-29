// Run once from the elimuos-app folder:  node use-logo.js
// Replaces the graduation-cap icon in every brand mark with your logo,
// and restyles .brand-mark in theme.css so the logo sits on a white tile.
const fs = require('fs'), path = require('path');

const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e =>
  e.isDirectory() ? (e.name === 'node_modules' ? [] : walk(path.join(d, e.name))) : e.name.endsWith('.html') ? [path.join(d, e.name)] : []);

const cap = /(<span class="brand-mark"[^>]*>)\s*<i class="bi bi-mortarboard-fill"><\/i>\s*(<\/span>)/g;
let pages = 0;
for (const f of walk('public')) {
  const t = fs.readFileSync(f, 'utf8');
  const out = t.replace(cap, '$1<img src="/assets/logo.png" alt="ElimuOs logo">$2');
  if (out !== t) { fs.writeFileSync(f, out); pages++; console.log('updated', f); }
}

const cssPath = 'public/css/theme.css';
let css = fs.readFileSync(cssPath, 'utf8');
const rule = '.brand-mark{ width: 38px; height: 38px; border-radius: 11px; background: var(--white); border: 1px solid var(--line); display: flex; align-items: center; justify-content: center; padding: 4px; box-shadow: 0 8px 16px -8px rgba(18,23,43,0.25); flex-shrink: 0; overflow: hidden; }\n.brand-mark img{ width: 100%; height: 100%; object-fit: contain; display: block; }';
if (!css.includes('.brand-mark img')) {
  css = css.replace(/\.brand-mark\{[^}]*\}/, rule);
  fs.writeFileSync(cssPath, css);
  console.log('updated', cssPath);
}
console.log(`Done. ${pages} page(s) now use the logo.`);