"""Build the tutorial step list from the committed reference rows plus the official strings.

The base TutorialEventInfo is the one imported: variant B is identical to it and variant A only
raises the tap counts, and which variant a live client gets is a server A/B assignment.
"""
import hashlib
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
REFERENCE = ROOT/'reference/tt2/8.2.0'


def main():
    assets = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT/'work/apk-analysis/text-assets'
    locale_path = next(assets.glob('*_LocalizationInfo_ChineseTrad.txt'))
    locale = json.loads(locale_path.read_text(encoding='utf-8-sig'))
    evidence = json.loads((REFERENCE/'tutorial-evidence.json').read_text(encoding='utf-8'))
    known = set(evidence['objectiveTypes'].values())
    rows = json.loads((REFERENCE/'TutorialEventInfo.json').read_text(encoding='utf-8'))['records']

    steps = []
    for record in rows:
        values = record['values']
        objective, _, amount = values['Objective'].partition(':')
        if objective not in known:
            raise ValueError(f'objective is not a native ObjectiveType: {objective}')
        if not amount.isdigit():
            raise ValueError(f'step {values["TutorialEventIndex"]}: unexpected amount {amount!r}')
        reward = values['GoldReward'].strip()
        if reward and not reward.isdigit():
            raise ValueError(f'step {values["TutorialEventIndex"]}: unexpected reward {reward!r}')
        text = locale.get(values['DisplayString'], '').strip()
        if not text:
            raise ValueError(f'step {values["TutorialEventIndex"]}: no official string for {values["DisplayString"]}')
        steps.append(dict(index=int(values['TutorialEventIndex']), objective=objective,
                          amount=int(amount), gold=int(reward) if reward else 0,
                          key=values['DisplayString'], text=text,
                          fills=values['ModifyString'].strip().upper() == 'TRUE',
                          showProgress=values['ShowProgress'].strip().upper() == 'TRUE'))
    if [step['index'] for step in steps] != list(range(len(steps))):
        raise ValueError('tutorial step indices are not a clean run')

    header = ('// TutorialEventInfo 8.2.0, base variant: variant B is identical and variant A only raises\n'
              '// the tap counts, so the base table is what is imported here.\n'
              '// An objective is met when progress reaches the amount; TapCount counts taps since the\n'
              '// step began, the other three are absolute (reference/tt2/8.2.0/tutorial-evidence.json).\n'
              '// Wording is the package ChineseTrad string for each DisplayString key.\n'
              f'// Localization SHA256: {hashlib.sha256(locale_path.read_bytes()).hexdigest()}\n')
    body = 'export const TT2_TUTORIAL=' + json.dumps(steps, ensure_ascii=False, separators=(',', ':')) + ' as const;\n'
    (ROOT/'lib/tt2-tutorial.ts').write_text(header + body, encoding='utf-8')
    paid = sum(1 for step in steps if step['gold'])
    print(f'Imported {len(steps)} tutorial steps, {paid} of them paying gold')


if __name__ == '__main__':
    main()
