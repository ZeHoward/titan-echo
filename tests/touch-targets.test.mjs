import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');

/** Every declaration that applies to a selector at the given viewport width, later rules winning. */
function resolve(selector, width) {
  const applied = {};
  const blocks = [];
  const media = /@media\(max-width:(\d+)px\)\{/g;
  let match;
  while ((match = media.exec(css))) {
    const limit = Number(match[1]);
    let depth = 1, index = media.lastIndex;
    while (depth > 0 && index < css.length) {
      if (css[index] === '{') depth += 1;
      else if (css[index] === '}') depth -= 1;
      index += 1;
    }
    if (width <= limit) blocks.push(css.slice(media.lastIndex, index - 1));
  }
  for (const block of [css.replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, ''), ...blocks]) {
    for (const rule of block.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selectors = rule[1].split(',').map(part => part.trim());
      if (!selectors.includes(selector)) continue;
      for (const declaration of rule[2].split(';')) {
        const [property, value] = declaration.split(':');
        if (property) applied[property.trim()] = value.trim();
      }
    }
  }
  return applied;
}

const CONTROLS = ['.top-actions button', '.buy-toolbar button', '.save-status button', '.save-status a'];

test('phone-width controls are at least 32px tall, the size measured as reachable', () => {
  for (const selector of CONTROLS) {
    const height = resolve(selector, 375)['min-height'];
    assert.ok(height, `${selector} 在手機寬度沒有 min-height`);
    assert.ok(Number.parseInt(height, 10) >= 32, `${selector} 只有 ${height}`);
  }
});

test('the header controls also get width, because icon-only buttons were 19px wide', () => {
  for (const selector of ['.top-actions button', '.buy-toolbar button']) {
    const width = resolve(selector, 375)['min-width'];
    assert.ok(Number.parseInt(width, 10) >= 32, `${selector} 寬度 ${width}`);
  }
  // The narrow-screen gap was reduced so the enlarged header still fits without side scrolling.
  assert.equal(resolve('.top-actions', 375).gap, '6px');
  assert.equal(resolve('.top-actions', 480).gap, '14px');
});

test('desktop keeps its original sizing: none of this applies above the breakpoint', () => {
  for (const selector of CONTROLS) {
    const desktop = resolve(selector, 1280);
    assert.equal(desktop['min-height'], undefined, selector);
    assert.equal(desktop['min-width'], undefined, selector);
  }
});
