"""Rebuild the Sword Master milestone table from the committed 8.2.0 reference records.

The reference JSON keeps every cell as the exact source text, so the table can be rebuilt
without the package itself. TotalNew reaches 9.07E+363, past the range of a double, which is
why the value is carried as its source text and parsed into a significand/exponent pair.
"""
import json
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parents[1]
REFERENCE = ROOT / 'reference/tt2/8.2.0/PlayerImprovementsInfo.json'
SCIENTIFIC = re.compile(r'^-?\d+(?:\.\d+)?[eE][+-]?\d+$')


def main():
    table = json.loads(REFERENCE.read_text(encoding='utf-8'))
    manifest = json.loads((ROOT / 'reference/tt2/8.2.0/manifest.json').read_text(encoding='utf-8'))
    entry = next(t for t in manifest['tables'] if t['table'] == 'PlayerImprovementsInfo')
    if entry['rows'] != len(table['records']):
        raise ValueError('reference record count disagrees with the manifest')
    facts = []
    for record in table['records']:
        total = record['values']['TotalNew'].strip()
        if not SCIENTIFIC.match(total):
            raise ValueError(f'unexpected TotalNew format: {total!r}')
        facts.append(dict(level=int(record['values']['Level']),
                          step=float(record['values']['AmountNew']), total=total))
    if not all(a['level'] < b['level'] for a, b in zip(facts, facts[1:])):
        raise ValueError('milestone levels are not strictly increasing')
    beyond = [f for f in facts if float(f['total']) > 1e240]
    header = ('// PlayerImprovementsInfo: verified Level / AmountNew / TotalNew reader in APK 8.2.0.\n'
              '// Rebuilt by tools/import-player-milestones.py from the committed reference records.\n'
              f'// TotalNew is kept as its source text: {len(beyond)} of {len(facts)} rows exceed 1e240\n'
              '// and the last one, 9.07E+363, has no double representation at all.\n'
              f"// Source: reference/tt2/8.2.0/PlayerImprovementsInfo.json ({entry['sourceSha256']}).\n")
    body = 'export const PLAYER_MILESTONES=' + json.dumps(facts, separators=(',', ':')) + ' as const;\n'
    (ROOT / 'lib/tt2-player-milestones.ts').write_text(header + body, encoding='utf-8')
    print(f'Imported {len(facts)} milestone rows, {len(beyond)} of them past the old 1e240 cap')


if __name__ == '__main__':
    main()
