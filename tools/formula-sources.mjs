// Validates docs/formula-sources.json against the code and the committed reference records, and
// renders the readable copy. The point is that a formula cannot be added, renamed or removed
// without the register noticing, and a cited source cannot be a file that does not exist.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const referenceRoot = new URL('reference/tt2/8.2.0/', root);
/** The modules whose exports must each be either a registered formula or a classified non-formula. */
export const COVERED = ['lib/engine.ts', 'lib/tt2-rules.ts', 'lib/tt2-player.ts', 'lib/tt2-perks.ts',
  'lib/tt2-pet-combat.ts', 'lib/tt2-collection.ts', 'lib/tt2-hero-passives.ts', 'lib/tt2-themes.ts',
  'lib/tt2-limits.ts', 'lib/big-number.ts'];

export function loadRegister() {
  return JSON.parse(readFileSync(new URL('docs/formula-sources.json', root), 'utf8'));
}

/** Every exported function and const in a module, by name. */
export function exportsOf(module) {
  const source = readFileSync(new URL(module, root), 'utf8');
  const names = new Set();
  for (const match of source.matchAll(/^export (?:async )?function (\w+)/gm)) names.add(match[1]);
  for (const match of source.matchAll(/^export const (\w+)\s*[=:(]/gm)) names.add(match[1]);
  return names;
}

export function validate(register = loadRegister()) {
  const problems = [];
  const classified = new Set(Object.values(register.notFormulas).flat());
  const registered = new Set(register.formulas.map(formula => formula.export));

  for (const formula of register.formulas) {
    if (!COVERED.includes(formula.module)) problems.push(`${formula.id}: 模組不在覆蓋清單：${formula.module}`);
    const names = exportsOf(formula.module);
    if (!names.has(formula.export)) problems.push(`${formula.id}: ${formula.module} 沒有匯出 ${formula.export}`);
    if (!formula.parts.length) problems.push(`${formula.id}: 沒有任何來源條目`);
    for (const part of formula.parts) {
      if (!register.statuses[part.status]) problems.push(`${formula.id}: 未知狀態 ${part.status}`);
      if (part.ref && !existsSync(new URL(part.ref, referenceRoot))) {
        problems.push(`${formula.id}: 引用的來源檔不存在：${part.ref}`);
      }
      const needsNote = ['baseline-75', 'invented', 'server', 'table-differs'];
      if (needsNote.includes(part.status) && !part.note && !part.ref) {
        problems.push(`${formula.id}／${part.part}: ${part.status} 必須寫明原因`);
      }
    }
  }

  const ids = register.formulas.map(formula => formula.id);
  if (new Set(ids).size !== ids.length) problems.push('公式 id 有重複');

  const uncovered = [];
  for (const module of COVERED) {
    for (const name of exportsOf(module)) {
      if (!registered.has(name) && !classified.has(name)) uncovered.push(`${module}#${name}`);
    }
  }
  if (uncovered.length) problems.push(`未歸類的匯出：${uncovered.join('、')}`);

  const stale = [...classified].filter(name => !COVERED.some(module => exportsOf(module).has(name)));
  if (stale.length) problems.push(`清單裡有已不存在的匯出：${stale.join('、')}`);

  const counts = {};
  for (const formula of register.formulas) {
    for (const part of formula.parts) counts[part.status] = (counts[part.status] ?? 0) + 1;
  }
  return { problems, counts, formulas: register.formulas.length,
    parts: Object.values(counts).reduce((total, value) => total + value, 0) };
}

function render(register, report) {
  const lines = ['# 核心公式來源登記表', '', register.role, '',
    `版本 ${register.version}。共 ${report.formulas} 條公式、${report.parts} 項來源條目。`, '',
    '| 狀態 | 意義 | 條目數 |', '|---|---|---|'];
  for (const [status, meaning] of Object.entries(register.statuses)) {
    lines.push(`| \`${status}\` | ${meaning} | ${report.counts[status] ?? 0} |`);
  }
  lines.push('', '## 逐條登記', '');
  for (const formula of register.formulas) {
    lines.push(`### ${formula.id} · \`${formula.module}\` 的 \`${formula.export}\``, '', formula.expression, '');
    lines.push('| 來源條目 | 狀態 | 依據 |', '|---|---|---|');
    for (const part of formula.parts) {
      const ref = part.ref ? `\`reference/tt2/8.2.0/${part.ref}\`` : '';
      lines.push(`| ${part.part} | \`${part.status}\` | ${[ref, part.note ?? ''].filter(Boolean).join('；')} |`);
    }
    lines.push('');
  }
  lines.push('## 界線', '');
  for (const limit of register.limits) lines.push(`- ${limit}`);
  lines.push('');
  return lines.join('\n');
}

if (import.meta.url === `file://${process.argv[1]?.replaceAll('\\', '/')}`
  || process.argv[1]?.endsWith('formula-sources.mjs')) {
  const register = loadRegister();
  const report = validate(register);
  for (const problem of report.problems) console.error(problem);
  writeFileSync(new URL('docs/formula-sources.md', root), render(register, report), 'utf8');
  console.log(`${report.formulas} formulas, ${report.parts} parts, ${report.problems.length} problems`);
  if (report.problems.length) process.exitCode = 1;
}
