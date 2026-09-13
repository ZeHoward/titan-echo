"""Record hashes and table differences without publishing original package data."""
import csv
import hashlib
import json
import pathlib
import re
import subprocess

root = pathlib.Path(__file__).resolve().parents[1]
assets = root / 'work/apk-analysis/text-assets'
baseline = root / 'work/tt2-csv'
tables = ['ArtifactInfo', 'ArtifactCostInfo', 'PetInfo', 'HelperInfo', 'HelperSkillInfo',
          'ActiveSkillInfo', 'SkillTreeInfo2.0', 'EquipmentSetInfo', 'C_EquipmentInfo',
          'PerkInfo', 'DailyRewardsInfo', 'PlayerImprovementsInfo', 'HelperImprovementsInfo', 'TitanCardInfo']

def sha(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()

def read(path):
    reader = csv.DictReader(path.read_text(encoding='utf-8-sig').splitlines())
    return reader.fieldnames, list(reader)

result = []
for table in tables:
    native = next(assets.glob('*_' + table + '.txt'))
    old = baseline / 'csv' / (table + '.csv')
    old_fields, old_rows = read(old)
    new_fields, new_rows = read(native)
    keys = ['Ascension', 'Level'] if table == 'HelperImprovementsInfo' else [old_fields[0]]
    def index(rows):
        values = {tuple(r[k].strip() for k in keys): r for r in rows}
        assert len(values) == len(rows), f'{table}: duplicate row key'
        return values
    before, after = index(old_rows), index(new_rows)
    shared = set(old_fields) & set(new_fields)
    changed = sum(any(before[k][f].strip() != after[k][f].strip() for f in shared) for k in before.keys() & after.keys())
    result.append(dict(table=table, key=keys, baselineRows=len(before), apkRows=len(after),
                       addedRows=len(after.keys()-before.keys()), removedRows=len(before.keys()-after.keys()),
                       changedSharedRows=changed, addedColumns=sorted(set(new_fields)-set(old_fields)),
                       baselineSha256=sha(old), apkTextSha256=sha(native)))

package = root / 'work/apk-analysis/tap-titans-2-8.2.0.xapk'
package_hash = sha(package)
assert package_hash == '8d78c9aa877e6c0b291ee2116cab855bd26c59c1d080bc654f88ecf1ff268b5f'
data = (root / 'lib/tt2-data.ts').read_text(encoding='utf-8')
catalogs = {name: len(json.loads(body)) for name, body in re.findall(r'export const (TT2_\w+) = (.*);', data)}
manifest = dict(
    auditedAt='2026-09-14', targetClientVersion='8.2.0',
    targetScope='Bundled client data and verifiable native behavior; live server overrides unknown',
    currentApplicationVersion=json.loads((root/'package.json').read_text())['version'],
    currentNumericBaseline='7.5.0',
    baselineCommit=subprocess.check_output(['git','-C',str(baseline),'rev-parse','HEAD'],text=True).strip(),
    package=dict(sha256=package_hash, bytes=package.stat().st_size, signerIndependentlyVerified=False),
    currentGeneratedCatalogCounts=catalogs,
    tableComparisonMethod='Trimmed shared-column strings; distinct from semantic numeric equality or enabled gameplay counts',
    tables=result,
    invariants=['Stable source IDs, not row positions, govern migrations',
                'Keep existing saves backed up; test idempotent migration and cloud CAS conflicts',
                'Static package defaults are not verified live server configuration'])
out = root / 'docs/reference-baseline.json'
out.write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(f'Wrote {out.relative_to(root)}: {len(result)} table comparisons')
