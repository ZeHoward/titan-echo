"""Report how this project's skill and talent names line up with the package's own.

The six active skills and the sixty-six talents are shown by name all over the interface, so the
names have to be the package's, not something typed in. This checks every one against the bundled
Traditional Chinese file and records the ones that cannot be copied verbatim because the package
text is itself part English — the same rule the set names follow.

  python tools/import-skill-names.py work/apk-analysis/text-assets
"""
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]


def catalogs():
    source = (ROOT/'lib/tt2-data.ts').read_text(encoding='utf-8')
    return {name: json.loads(body) for name, body in re.findall(r'export const (TT2_\w+) = (.*);', source)}


def main():
    assets = pathlib.Path(sys.argv[1])
    chinese = json.loads(next(assets.glob('*_LocalizationInfo_ChineseTrad.txt')).read_text(encoding='utf-8-sig'))
    english = json.loads(next(assets.glob('*_LocalizationInfo_English.txt')).read_text(encoding='utf-8-sig'))
    catalog = catalogs()

    # Only the package side is recorded here. Whether this project shows the official name is a
    # question about the interface, so tests/name-parity.test.mjs asks it against these entries.
    def classify(key):
        official = (chinese.get(key) or '').strip()
        source = (english.get(key) or '').strip()
        if not official:
            return dict(status='not-named-in-package')
        if '{' in official:
            return dict(status='template', english=source, chineseTrad=official)
        if re.search('[A-Za-z]', official):
            return dict(status='partly-untranslated', english=source, chineseTrad=official)
        return None

    groups = {}
    for label, rows, prefix in [
        ('activeSkills', catalog['TT2_ACTIVE'], 'ACTIVE_SKILL_NAME_'),
        ('talents', catalog['TT2_TREE'], 'SKILLTREE_'),
    ]:
        flagged, official = [], {}
        for row in rows:
            key = prefix + row['id'].upper()
            entry = classify(key)
            if entry:
                flagged.append(dict(id=row['id'], key=key, **entry))
            else:
                official[row['id']] = chinese[key].strip()
        groups[label] = dict(total=len(rows), flagged=len(flagged), entries=flagged, official=official)

    document = dict(
        version='8.2.0',
        basis='official ACTIVE_SKILL_NAME and SKILLTREE keys from the bundled localization files',
        note='a flagged name is not copied verbatim; the package text itself is templated or partly English',
        **groups)
    (ROOT/'reference/tt2/8.2.0/skill-name-parity.json').write_text(
        json.dumps(document, ensure_ascii=False, indent=2)+'\n', encoding='utf-8', newline='\n')
    print(json.dumps({label: (group['total'], group['flagged']) for label, group in groups.items()}))


if __name__ == '__main__':
    main()
