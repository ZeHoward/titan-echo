"""Import the package's own name for every bonus type this project labels, and report the parity.

Unlike hero and artifact names, the package's Traditional Chinese is not self-consistent here: the
BONUS_ block and the rest of the same file disagree on which word to use for several core terms.
So this imports the official strings as data and records the disagreement, rather than swapping the
interface over to wording the package itself does not use consistently.
"""
import hashlib
import json
import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
# Pairs the project's glossary has to choose between; both words appear in the package.
GLOSSARY = [('金幣', '黃金'), ('蛻變', '聲望'), ('聖物', '遺物'), ('技能', '法術'), ('妖精', '精靈')]


def project_labels():
    script = "import {EFFECT_LABELS} from './lib/tt2-rules.ts';console.log(JSON.stringify(EFFECT_LABELS));"
    path = ROOT/'bonus-labels.probe.mjs'
    path.write_text(script, encoding='utf-8')
    try:
        node = pathlib.Path(sys.argv[2]) if len(sys.argv) > 2 else pathlib.Path('node')
        out = subprocess.run([str(node), '--experimental-strip-types', str(path)],
                             cwd=ROOT, capture_output=True, text=True, encoding='utf-8', check=True)
        return json.loads(out.stdout.strip())
    finally:
        path.unlink(missing_ok=True)


def main():
    assets = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT/'work/apk-analysis/text-assets'
    locale_path = next(assets.glob('*_LocalizationInfo_ChineseTrad.txt'))
    locale = json.loads(locale_path.read_text(encoding='utf-8-sig'))
    ours = project_labels()

    official, missing, unusable = {}, [], []
    for key in ours:
        value = (locale.get('BONUS_' + key) or '').strip()
        if not value:
            missing.append(key)
        elif re.search(r'[A-Za-z{}<>]', value):
            unusable.append(dict(id=key, official=value, status='partly-untranslated'))
        else:
            official[key] = value
    differing = sorted(key for key, value in official.items() if value != ours[key])

    bonus = {k: v for k, v in locale.items() if k.startswith('BONUS_') and not k.startswith('BONUS_DESC_')}
    other = {k: v for k, v in locale.items() if not k.startswith('BONUS_')}

    def count(bag, term):
        return sum(1 for value in bag.values() if isinstance(value, str) and term in value)

    glossary = []
    for kept, alternative in GLOSSARY:
        inside = (count(bonus, kept), count(bonus, alternative))
        outside = (count(other, kept), count(other, alternative))
        glossary.append(dict(projectTerm=kept, packageAlternative=alternative,
                             inBonusStrings=dict(kept=inside[0], alternative=inside[1]),
                             inOtherStrings=dict(kept=outside[0], alternative=outside[1]),
                             blocksAdoption=(inside[0] > inside[1]) != (outside[0] > outside[1])))

    report = dict(
        version='8.2.0', role='效果標籤與安裝包官方字串的逐項核對',
        localizationSha256=hashlib.sha256(locale_path.read_bytes()).hexdigest(),
        labels=len(ours), withOfficialString=len(official), differingFromProject=len(differing),
        withoutOfficialString=missing, unusableOfficialStrings=unusable,
        differing=[dict(id=key, project=ours[key], official=official[key]) for key in differing],
        glossary=glossary,
        decision='官方字串已匯入為資料，但介面維持本專案既有用語：安裝包的繁中在 BONUS_ 區與其他字串之間'
                 '對「聖物／遺物」與「妖精／精靈」剛好相反，照抄只會把不一致帶進介面。',
        limits=['這是用詞核對，不是對效果數值的判定',
                '若日後改採官方用語，differing 清單就是需要逐條檢視的範圍'])
    (ROOT/'reference/tt2/8.2.0/bonus-label-parity.json').write_text(
        json.dumps(report, ensure_ascii=False, indent=2)+'\n', encoding='utf-8', newline='\n')

    header = ('// The package name for every bonus type this project labels, imported for comparison.\n'
              '// Not wired into the interface: see reference/tt2/8.2.0/bonus-label-parity.json for why.\n'
              f'// Localization SHA256: {report["localizationSha256"]}\n')
    body = ('export const OFFICIAL_BONUS_LABELS:Record<string,string>='
            + json.dumps(official, ensure_ascii=False, indent=2) + ';\n')
    (ROOT/'lib/tt2-bonus-labels.ts').write_text(header + body, encoding='utf-8')
    blocked = [row['projectTerm'] for row in glossary if row['blocksAdoption']]
    print(f'Imported {len(official)} official bonus labels; {len(differing)} differ from this project. '
          f'Terms the package uses inconsistently: {", ".join(blocked) or "none"}')


if __name__ == '__main__':
    main()
