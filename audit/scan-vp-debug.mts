import { SCANNER_JS } from "../src/scanner.ts";

const SCANNER_NO_VP = SCANNER_JS.replace(
  /function cropRectToVisible\(rect\) \{[\s\S]*?return bounded;\s*\}/,
  `function cropRectToVisible(rect) {
    if (rect.width < 3 || rect.height < 3) return null;
    return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
  }`
);

// Check that the replace actually happened
if (SCANNER_JS === SCANNER_NO_VP) {
  console.log("ERROR: regex did not match — variant identical to original");
} else {
  console.log("OK: regex matched, scanner modified");
}

// Find the cropRectToVisible function in both
const orig = SCANNER_JS.match(/function cropRectToVisible[\s\S]*?\n  \}/);
const patched = SCANNER_NO_VP.match(/function cropRectToVisible[\s\S]*?\n  \}/);
console.log("\n--- ORIGINAL cropRectToVisible ---");
console.log(orig?.[0]);
console.log("\n--- PATCHED cropRectToVisible ---");
console.log(patched?.[0]);

// Now check whether the FULL getVisibleRect chain has any other viewport filter
const getVisRectOrig = SCANNER_JS.match(/function getVisibleRect[\s\S]*?\n  \}/);
console.log("\n--- getVisibleRect (unchanged) ---");
console.log(getVisRectOrig?.[0]);
