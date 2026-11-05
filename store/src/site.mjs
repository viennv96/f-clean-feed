// Prerenders docs/index.html for crawlers and link previews (Facebook, Zalo,
// Messenger read no JavaScript): fills every [data-t] element with its
// Vietnamese string and writes the JSON-LD blocks. The in-page script still
// switches languages at runtime from the same strings.
//   node store/src/site.mjs
import { readFileSync, writeFileSync } from "node:fs";

const PAGE = "docs/index.html";
const BASE = "https://viennv96.github.io/f-clean-feed/";
// Strings that legitimately contain markup (authored in the page itself).
const HTML_KEYS = new Set(["s1", "s2", "s3", "s4"]);

let html = readFileSync(PAGE, "utf8");
const version = JSON.parse(readFileSync("manifest.json", "utf8")).version;

const block = html.match(/const T = (\{[\s\S]*?\n {2}\});/);
if (!block) throw new Error("strings table `const T = {...};` not found");
const T = Function(`return (${block[1]});`)();
const vi = T.vi;

const escapeHtml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const stripTags = (s) => s.replace(/<[^>]+>/g, "");

// <tag ... data-t="key" ...>anything</tag>, innermost text only (no nesting of the same tag).
let filled = 0;
html = html.replace(/(<(\w+)\b[^>]*\bdata-t="(\w+)"[^>]*>)([\s\S]*?)(<\/\2>)/g, (all, open, tag, key, _inner, close) => {
  if (!(key in vi)) throw new Error(`no Vietnamese string for data-t="${key}"`);
  filled++;
  return open + (HTML_KEYS.has(key) ? vi[key] : escapeHtml(vi[key])) + close;
});

const app = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "F Clean Feed",
  alternateName: "F Clean Feed – Ad & Reels blocker for Facebook",
  description: stripTags(vi.lead),
  applicationCategory: "BrowserApplication",
  applicationSubCategory: "Ad blocker",
  operatingSystem: "Google Chrome, Microsoft Edge, Brave, Cốc Cốc",
  softwareVersion: version,
  isAccessibleForFree: true,
  offers: { "@type": "Offer", price: "0", priceCurrency: "VND" },
  inLanguage: ["vi", "en"],
  url: BASE,
  downloadUrl: "https://github.com/viennv96/f-clean-feed/releases/latest",
  image: `${BASE}assets/icon-512.png`,
  screenshot: [1, 2, 3].map((n) => `${BASE}assets/vi-screenshot-${n}.png`),
  author: { "@type": "Person", name: "Nguyễn Văn Viên", url: "https://viennv.dev" },
};

const faq = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: Object.keys(vi)
    .filter((k) => /^q\d+$/.test(k))
    .map((k) => ({
      "@type": "Question",
      name: vi[k],
      acceptedAnswer: { "@type": "Answer", text: stripTags(vi[`a${k.slice(1)}`]) },
    })),
};

// "<" is escaped so a string can never close the script element.
const ld = (obj) => JSON.stringify(obj, null, 2).replace(/</g, "\\u003c");
html = html.replace(/(<script type="application\/ld\+json" id="ld-app">)[\s\S]*?(<\/script>)/, `$1\n${ld(app)}\n$2`);
html = html.replace(/(<script type="application\/ld\+json" id="ld-faq">)[\s\S]*?(<\/script>)/, `$1\n${ld(faq)}\n$2`);

writeFileSync(PAGE, html);
console.log(`prerendered ${filled} strings, ${faq.mainEntity.length} FAQ entries, version ${version}`);
