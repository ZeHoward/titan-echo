"""Only the pinned server var loaders have an evidenced row policy."""

TABLE = 'ServerVarOverride'
FIELDS = ('ServerVarsKey', 'Value')

def resolve_server_var_overrides(table, rows):
    """Replay the native loop: skip blank keys, keep the last row that stores a key."""
    if table != TABLE:
        raise ValueError('overwrite policy is restricted to server var overrides')
    selected, ordinals, history = {}, {}, {}
    for ordinal, row in enumerate(rows):
        if set(row) != set(FIELDS):
            raise ValueError('server var override schema changed')
        identity, value = row['ServerVarsKey'], row['Value']
        if not isinstance(identity, str) or not isinstance(value, str):
            raise ValueError(f'missing server var cell at row {ordinal}')
        # The native guard skips a null or whitespace key before storing the row.
        if not identity.strip():
            continue
        if identity != identity.strip():
            raise ValueError(f'padded server var key at row {ordinal}')
        # An empty value cell is not distinguishable from a null cell here, so stop instead of guessing.
        if not value.strip():
            raise ValueError(f'empty server var value: {identity}')
        selected[identity] = dict(row)
        ordinals[identity] = ordinal
        history.setdefault(identity, []).append(dict(sourceOrdinal=ordinal, values=dict(row)))
    return selected, ordinals, {k: v for k, v in history.items() if len(v) > 1}
