"""Import short display names and verified hero facts; never package raw APK assets."""
import csv
import hashlib
import json
import pathlib
import re
import sys

root = pathlib.Path(__file__).resolve().parents[1]
assets = pathlib.Path(sys.argv[1])
locale_path = next(assets.glob('*_LocalizationInfo_ChineseTrad.txt'))
locale = json.loads(locale_path.read_text(encoding='utf-8'))
data_path = root / 'lib/tt2-data.ts'
source = data_path.read_text(encoding='utf-8')
catalog = {name: json.loads(body) for name, body in re.findall(r'export const (TT2_\w+) = (.*);', source)}
groups = [('TT2_HEROES', 'HELPERNAME_', False), ('TT2_PETS', 'PET_NAME_', False),
          ('TT2_TREE', 'SKILLTREE_', True), ('TT2_SETS', 'EQUIPMENT_SET_', False),
          ('TT2_ARTIFACTS', 'ARTIFACT_NAME_', False)]
names = {}
skipped = []
for group, prefix, uppercase in groups:
    for row in catalog[group]:
        key = prefix + (row['id'].upper() if uppercase else row['id'])
        value = locale.get(key, '').strip()
        if not value or re.search('[A-Za-z{}<>]', value):
            skipped.append(key)
            continue
        names[key] = value
        if group == 'TT2_ARTIFACTS':
            row['name'] = value
body = json.dumps(catalog['TT2_ARTIFACTS'], ensure_ascii=False, separators=(',', ':'))
source = re.sub(r'export const TT2_ARTIFACTS = .*;', lambda _: 'export const TT2_ARTIFACTS = ' + body + ';', source)
data_path.write_text(source, encoding='utf-8')
header = '// Short names from TT2 8.2.0 ChineseTrad; numerical rules remain 7.5.0.\n'
header += '// Source SHA256: ' + hashlib.sha256(locale_path.read_bytes()).hexdigest() + '\n'
(root / 'lib/tt2-source-names.ts').write_text(header + 'export const SOURCE_NAMES:Record<string,string>=' + json.dumps(names, ensure_ascii=False, indent=2) + ';\n', encoding='utf-8')
skill_path = next(assets.glob('*_HelperSkillInfo.txt'))
rows = list(csv.DictReader(skill_path.read_text(encoding='utf-8-sig').splitlines()))
baseline = list(csv.DictReader((root / 'work/tt2-csv/csv/HelperSkillInfo.csv').read_text(encoding='utf-8-sig').splitlines()))
fields = ['HelperSkillID', 'Owner', 'BonusType', 'Magnitude', 'RequiredLevel']
assert [[r[k].strip() for k in fields] for r in rows] == [[r[k].strip() for k in fields] for r in baseline]
facts = [dict(id=r['HelperSkillID'], owner=r['Owner'], effect=r['BonusType'], value=float(r['Magnitude']), level=int(r['RequiredLevel'])) for r in rows]
(root / 'lib/tt2-hero-skills.ts').write_text('// HelperSkillInfo: identical facts in pinned 7.5 and extracted 8.2.0.\nexport const HERO_SKILLS=' + json.dumps(facts, separators=(',', ':')) + ';\n', encoding='utf-8')
print(json.dumps(dict(names=len(names), skipped=skipped, heroSkills=len(facts)), ensure_ascii=False))
