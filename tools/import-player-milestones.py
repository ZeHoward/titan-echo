"""Import numerical milestone facts after checking the two reference snapshots."""
import csv
import decimal
import hashlib
import json
import pathlib
import sys

root = pathlib.Path(__file__).resolve().parents[1]
source = next(pathlib.Path(sys.argv[1]).glob('*_PlayerImprovementsInfo.txt'))
rows = list(csv.DictReader(source.read_text(encoding='utf-8-sig').splitlines()))
baseline = list(csv.DictReader((root / 'work/tt2-csv/csv/PlayerImprovementsInfo.csv').read_text(encoding='utf-8-sig').splitlines()))
assert rows == baseline, 'Player milestone snapshots differ; review before importing'
facts = []
for row in rows:
    facts.append(dict(level=int(row['Level']), step=float(row['AmountNew']),
                      total=float(min(decimal.Decimal(row['TotalNew']), decimal.Decimal('1e240')))))
assert all(a['level'] < b['level'] for a, b in zip(facts, facts[1:]))
header = '// PlayerImprovementsInfo: verified Level / AmountNew / TotalNew reader in APK 8.2.0.\n'
header += '// Identical 7.5 table; values capped at the web engine limit, 1e240.\n'
header += '// TextAsset SHA256: ' + hashlib.sha256(source.read_bytes()).hexdigest() + '\n'
(root / 'lib/tt2-player-milestones.ts').write_text(header + 'export const PLAYER_MILESTONES=' + json.dumps(facts, separators=(',', ':')) + ';\n', encoding='utf-8')
print(f'Imported {len(facts)} milestone rows')
