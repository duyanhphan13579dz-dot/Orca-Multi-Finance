import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

describe("Phase 5: Mobile & Desktop Viewport UX and Zero-Overflow Matrix", () => {
  const rootDir = path.resolve(__dirname, "../../..");
  const globalsCss = fs.readFileSync(path.join(rootDir, "src/app/globals.css"), "utf8");
  const stockFsCss = fs.readFileSync(path.join(rootDir, "src/app/stock-fs-table.css"), "utf8");
  const bangDienCss = fs.readFileSync(path.join(rootDir, "src/components/stocks/bang-dien.css"), "utf8");
  const shellInnerTsx = fs.readFileSync(path.join(rootDir, "src/components/shell-inner.tsx"), "utf8");
  const mobileNavTsx = fs.readFileSync(path.join(rootDir, "src/components/mobile-bottom-nav.tsx"), "utf8");

  it("globals.css defines Zero-Overflow foundations for media and text elements", () => {
    assert.match(globalsCss, /img,\s*video,\s*canvas,\s*svg\s*\{\s*max-width:\s*100%/);
    assert.match(globalsCss, /\.truncate-safe/);
    assert.match(globalsCss, /\.break-word-safe/);
    assert.match(globalsCss, /overflow-wrap:\s*anywhere/);
  });

  it("globals.css defines standardized responsive table scroll utilities with iOS inertia", () => {
    assert.match(globalsCss, /\.table-scroll-wrap/);
    assert.match(globalsCss, /\.table-scroll/);
    assert.match(globalsCss, /-webkit-overflow-scrolling:\s*touch/);
    assert.match(globalsCss, /overscroll-behavior-x:\s*contain/);
  });

  it("globals.css defines touch-action manipulation to eliminate 300ms tap delay on mobile", () => {
    assert.match(globalsCss, /touch-action:\s*manipulation/);
  });

  it("globals.css defines touch target minimum rules (>= 40px-44px) on mobile", () => {
    assert.match(globalsCss, /\.touch-target\s*\{[^}]*min-height:\s*44px/);
    assert.match(globalsCss, /\.touch-target-sm\s*\{[^}]*min-height:\s*40px/);
  });

  it("stock-fs-table.css supports sticky metric column with horizontal overflow scroll", () => {
    assert.match(stockFsCss, /\.stock-fs-scroll/);
    assert.match(stockFsCss, /-webkit-overflow-scrolling:\s*touch/);
    assert.match(stockFsCss, /overscroll-behavior-x:\s*contain/);
    assert.match(stockFsCss, /position:\s*sticky/);
    assert.match(stockFsCss, /left:\s*0/);
  });

  it("bang-dien.css enables touch panning and smooth inertia scrolling on mobile rails", () => {
    assert.match(bangDienCss, /-webkit-overflow-scrolling:\s*touch/);
    assert.match(bangDienCss, /touch-action:\s*pan-x/);
    assert.match(bangDienCss, /overscroll-behavior-x:\s*contain/);
  });

  it("shell-inner.tsx provides safe-area bottom padding to avoid bottom-bar overlay", () => {
    assert.match(shellInnerTsx, /pb-\[calc\(4\.25rem\+env\(safe-area-inset-bottom\)\)\]/);
  });

  it("mobile-bottom-nav.tsx provides safe-area padding and 5-column thumb accessibility", () => {
    assert.match(mobileNavTsx, /pb-\[env\(safe-area-inset-bottom\)\]/);
    assert.match(mobileNavTsx, /grid h-\[54px\] grid-cols-5/);
    assert.match(mobileNavTsx, /max-w-\[58px\] truncate/);
  });
});
