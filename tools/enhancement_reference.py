"""Only the pinned enhancement parser has an evidenced overwrite policy."""
import math
import re

TABLE = 'C_EquipmentEnhancementScalingInfo'
FIELDS = ('BonusType', 'AttributeBase', 'PowerBase', 'PowerInc', 'PowerExp')
DECIMAL = re.compile(r'[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?\Z')

def resolve_enhancements(table, rows, known_bonus_ids):
    if table != TABLE:
        raise ValueError('overwrite policy is restricted to enhancement scaling')
    selected, ordinals, history = {}, {}, {}
    for ordinal, row in enumerate(rows):
        if set(row) != set(FIELDS):
            raise ValueError('enhancement schema changed')
        identity = row['BonusType']
        if identity not in known_bonus_ids:
            raise ValueError(f'unknown enhancement bonus: {identity}')
        # Fail closed on unsupported input, instead of silently emulating all .NET parsing.
        # Every numeric lexeme in the pinned source passes these checks.
        for field in FIELDS[1:]:
            value = row[field]
            if not isinstance(value, str) or not DECIMAL.fullmatch(value) or not math.isfinite(float(value)):
                raise ValueError(f'invalid enhancement number: {identity}.{field}')
        selected[identity] = dict(row)
        ordinals[identity] = ordinal
        history.setdefault(identity, []).append(dict(sourceOrdinal=ordinal, values=dict(row)))
    return selected, ordinals, {k: v for k, v in history.items() if len(v) > 1}
