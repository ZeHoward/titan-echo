"""Build an isolated, lossless numerical catalog; never modify runtime/save data."""
import csv
import hashlib
import io
import json
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parents[1]
ASSETS = ROOT / 'work/apk-analysis/text-assets'
OUT = ROOT / 'reference/tt2/8.2.0'
TABLES = ['ArtifactInfo', 'ArtifactCostInfo', 'ActiveSkillInfo', 'ActiveSkillMultiCastInfo',
          'SkillTreeInfo2.0', 'EquipmentSetInfo', 'C_EquipmentInfo', 'HelperInfo', 'PetInfo',
          'PassiveSkillInfo', 'HelperSkillInfo', 'BonusInfo', 'DailyRewardsInfo', 'PerkInfo',
          'ClanScrollInfo', 'HelperImprovementsInfo', 'PlayerImprovementsInfo', 'TitanScalingInfo']
OMIT = {'Name', 'Note', 'Description', 'PetName', 'NameColor', 'BonusIcon', 'TextSpriteIndex'}
DECIMAL = re.compile(r'[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?\Z')

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def parse(path):
    reader = csv.DictReader(io.StringIO(path.read_text(encoding='utf-8-sig')))
    fields = reader.fieldnames
    if not fields or len(fields) != len(set(fields)):
        raise ValueError(f'{path.name}: missing or duplicate columns')
    rows = list(reader)
    if any(None in r or None in r.values() for r in rows):
        raise ValueError(f'{path.name}: malformed row')
    return fields, [{k: v.strip() for k, v in r.items()} for r in rows]

def key(row, keys):
    parts = [row[k] for k in keys]
    if any(p in ('', '-') for p in parts):
        raise ValueError('missing stable ID')
    return parts[0] if len(parts) == 1 else json.dumps(parts, separators=(',', ':'))

def index(rows, keys):
    result = {}
    for row in rows:
        identity = key(row, keys)
        if identity in result:
            raise ValueError(f'duplicate stable ID: {identity}')
        result[identity] = row
    return result

def write(name, value):
    (OUT / name).write_text(json.dumps(value, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8', newline='\n')

def main():
    audit = json.loads((ROOT / 'docs/reference-baseline.json').read_text())
    if sha(ROOT / 'work/apk-analysis/tap-titans-2-8.2.0.xapk') != audit['package']['sha256']:
        raise ValueError('APK hash mismatch')
    pinned = {r['table']: r['apkTextSha256'] for r in audit['tables']}
    OUT.mkdir(parents=True, exist_ok=True)
    manifest, catalogs = [], {}
    for table in TABLES:
        paths = list(ASSETS.glob('*_' + table + '.txt'))
        if len(paths) != 1:
            raise ValueError(f'{table}: expected exactly one source')
        path = paths[0]
        if table in pinned and sha(path) != pinned[table]:
            raise ValueError(f'{table}: source hash mismatch')
        fields, rows = parse(path)
        keys = ['Ascension', 'Level'] if table == 'HelperImprovementsInfo' else [fields[0]]
        indexed = index(rows, keys)
        retained = [f for f in fields if f not in OMIT]
        schema = {}
        for field in retained:
            values = {r[field] for r in rows} - {'', '-'}
            kind = 'identifier' if field in keys else ('boolean' if values and all(v.lower() in ('true', 'false') for v in values) else 'decimal' if values and all(DECIMAL.fullmatch(v) for v in values) else 'token')
            schema[field] = kind
        records = []
        for ordinal, (identity, row) in enumerate(indexed.items()):
            # Preserve missing-cell distinctions and every decimal lexeme, even > 1e308.
            values = {f: row[f] for f in retained}
            flags = {f: row[f] for f in ('Enabled', 'IsInGame', 'LimitedTime', 'SkillType', 'SetType') if f in row}
            records.append(dict(id=identity, sourceOrdinal=ordinal, values=values,
                                availabilityEvidence=flags, activation='unverified', verification='pending'))
        old = ROOT / 'work/tt2-csv/csv' / (table + '.csv')
        diff = None
        if old.exists():
            old_fields, old_rows = parse(old)
            before = index(old_rows, keys)
            shared = set(fields) & set(old_fields) - OMIT
            diff = dict(added=sorted(indexed.keys()-before.keys()), removed=sorted(before.keys()-indexed.keys()),
                        changed=sorted(k for k in indexed.keys() & before.keys() if any(indexed[k][f] != before[k][f] for f in shared)),
                        addedColumns=sorted(set(fields)-set(old_fields)), removedColumns=sorted(set(old_fields)-set(fields)))
        data = dict(version='8.2.0', table=table, keys=keys, schema=schema, omittedColumns=sorted(set(fields)&OMIT),
                    missingValues=['', '-'], records=records, differenceFrom75=diff)
        write(table + '.json', data)
        catalogs[table] = indexed
        manifest.append(dict(table=table, rows=len(rows), sourceSha256=sha(path), catalogSha256=sha(OUT/(table+'.json'))))
    legacy = {}
    source = (ROOT / 'lib/tt2-data.ts').read_text(encoding='utf-8')
    mapping = dict(TT2_ARTIFACTS='ArtifactInfo', TT2_ACTIVE='ActiveSkillInfo', TT2_TREE='SkillTreeInfo2.0',
                   TT2_SETS='EquipmentSetInfo', TT2_HEROES='HelperInfo', TT2_PETS='PetInfo', TT2_GEAR='C_EquipmentInfo')
    for name, body in re.findall(r'export const (TT2_\w+) = (.*);', source):
        if name not in mapping:
            continue
        rows = json.loads(body)
        ids = [r['id'] for r in rows]
        if len(set(ids)) != len(ids):
            raise ValueError(f'{name}: duplicate legacy ID')
        target = catalogs[mapping[name]]
        legacy[name] = dict(table=mapping[name], entries=[dict(legacyIndex=i, id=v, targetId=v if v in target else None) for i,v in enumerate(ids)])
    write('legacy-2.6.json', dict(runtimeSourceSha256=sha(ROOT/'lib/tt2-data.ts'), catalogs=legacy))
    write('manifest.json', dict(version='8.2.0', packageSha256=audit['package']['sha256'], runtimeEnabled=False,
                               tables=manifest, resourceIndex=[dict(name=p.name, sha256=sha(p), bytes=p.stat().st_size,
                               parsed=any(p.name.endswith('_'+t+'.txt') for t in TABLES)) for p in sorted(ASSETS.glob('*.txt'))]))
    print(f'Imported {len(manifest)} tables, {sum(t["rows"] for t in manifest)} records; runtime unchanged')

if __name__ == '__main__':
    main()
