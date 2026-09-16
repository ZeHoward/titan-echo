"""Build the achievement table from the committed reference rows plus the official strings.

Rows come from reference/tt2/8.2.0/AchievementInfo.json, which keeps every cell as its source
text; Requirement reaches 1e1500, which is why it stays text and is parsed into a pair at use.
The wording comes from the package's own ChineseTrad localization, where each achievement has a
description template with a {0} placeholder rather than a name, so that is what is imported.
"""
import hashlib
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
REFERENCE = ROOT/'reference/tt2/8.2.0'
NUMBER = re.compile(r'^\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$')


def main():
    assets = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT/'work/apk-analysis/text-assets'
    locale_path = next(assets.glob('*_LocalizationInfo_ChineseTrad.txt'))
    locale = json.loads(locale_path.read_text(encoding='utf-8-sig'))
    evidence = json.loads((REFERENCE/'achievement-parser-evidence.json').read_text(encoding='utf-8'))
    rows = json.loads((REFERENCE/'AchievementInfo.json').read_text(encoding='utf-8'))['records']

    known = set(evidence['achievementTypes'].values())
    facts = []
    for record in rows:
        kind = record['values']['Type']
        if kind not in known:
            raise ValueError(f'row type is not a native AchievementType: {kind}')
        requirement = [cell.strip() for cell in record['values']['Requirement'].split(',')]
        reward = [cell.strip() for cell in record['values']['Reward'].split(',')]
        if len(requirement) != len(reward):
            raise ValueError(f'{kind}: {len(requirement)} tiers but {len(reward)} rewards')
        if not all(NUMBER.match(cell) for cell in requirement + reward):
            raise ValueError(f'{kind}: unexpected cell format')
        description = locale.get(f'ACHIEVEMENT_DESC_{kind}', '').strip()
        if '{0}' not in description:
            raise ValueError(f'{kind}: no official description template')
        facts.append(dict(type=kind, requirement=requirement,
                          diamondReward=[int(cell) for cell in reward], description=description))
    if len(facts) != len(rows):
        raise ValueError('lost a row on the way')

    panel = {key: locale[key] for key in ('ACHIEVEMENT_PANEL_DESC', 'ACHIEVEMENTS_PANEL_MILESTONES_TITLE',
                                          'ACHIEVEMENTS_PANEL_PROGRESSION_TITLE') if key in locale}
    header = ('// AchievementInfo 8.2.0: Type, Requirement and Reward are the three columns\n'
              '// AchievementModel.Initialize reads (reference/tt2/8.2.0/achievement-parser-evidence.json).\n'
              '// Requirement is a list of GHDouble natively and reaches 1e1500, so it stays as source text.\n'
              '// Reward lands in the native field named diamondReward, so the reward is diamonds.\n'
              '// Wording is the package ChineseTrad description template, which has a {0} placeholder\n'
              f'// rather than a name. Localization SHA256: {hashlib.sha256(locale_path.read_bytes()).hexdigest()}\n')
    body = ('export const TT2_ACHIEVEMENTS=' + json.dumps(facts, ensure_ascii=False, separators=(',', ':'))
            + ' as const;\n'
            + 'export const ACHIEVEMENT_PANEL_TEXT=' + json.dumps(panel, ensure_ascii=False, separators=(',', ':'))
            + ' as const;\n')
    (ROOT/'lib/tt2-achievements.ts').write_text(header + body, encoding='utf-8')
    tiers = sum(len(fact['requirement']) for fact in facts)
    print(f'Imported {len(facts)} achievements, {tiers} tiers, {len(panel)} panel strings')


if __name__ == '__main__':
    main()
