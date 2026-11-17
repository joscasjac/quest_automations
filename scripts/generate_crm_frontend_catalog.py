"""Regenerate bounded Frappe CRM editor inputs from the companion crm_conversations checkout."""
import argparse
import ast
import json
from pathlib import Path

from generate_pulse_frontend_catalog import table


def module_tables(path, names):
    """Read literal dict tables whose values may reuse earlier tables, e.g. (*REQUIRED['x'], 'phone')."""
    tables = {}

    def value(node):
        if isinstance(node, ast.Subscript) and isinstance(node.value, ast.Name) and node.value.id in tables:
            return tables[node.value.id][ast.literal_eval(node.slice)]
        if isinstance(node, (ast.Tuple, ast.List)):
            items = []
            for element in node.elts:
                items.extend(value(element.value) if isinstance(element, ast.Starred) else [value(element)])
            return tuple(items)
        if isinstance(node, ast.Dict):
            return {ast.literal_eval(k): value(v) for k, v in zip(node.keys, node.values)}
        return ast.literal_eval(node)

    for node in ast.parse(path.read_text()).body:
        if isinstance(node, ast.Assign) and isinstance(node.targets[0], ast.Name) and node.targets[0].id in names:
            tables[node.targets[0].id] = value(node.value)
    return tables


OBJECTS = set()
ARRAYS = {'channels'}
CHECKS = set()
NUMBERS = {'limit', 'duration'}


def build(required, allowed):
    catalog = {}
    for action, fields in required.items():
        optional = sorted(set(allowed.get(action.removeprefix('crm_'), fields)) - set(fields))
        all_fields = list(fields) + optional
        catalog[action] = {'label': 'CRM: ' + action.removeprefix('crm_').replace('_', ' '),
            'required': list(fields), 'optional': optional,
            'types': {key: 'object' if key in OBJECTS else 'array' if key in ARRAYS else 'boolean' if key in CHECKS else 'number' if key in NUMBERS else 'string' for key in all_fields}}
    return catalog


if __name__ == '__main__':
    parser = argparse.ArgumentParser(); parser.add_argument('--crm-repo', type=Path, required=True,
        help='Checkout of the crm_conversations app (contains crm_conversations/api/automation.py)')
    args = parser.parse_args(); root = Path(__file__).resolve().parents[1]
    required = table(root / 'quest_automations/core/definition.py', 'CRM_ACTIONS')
    contract = module_tables(args.crm_repo / 'crm_conversations/api/automation.py', {'REQUIRED', 'ALLOWED'})
    allowed = contract['ALLOWED']
    expected = {action.removeprefix('crm_'): tuple(fields) for action, fields in required.items()}
    if expected != {key: tuple(fields) for key, fields in contract['REQUIRED'].items()}:
        raise SystemExit('CRM_ACTIONS does not match REQUIRED in crm_conversations; update definition.py first')
    catalog = build(required, allowed)
    destination = root / 'frontend/src/adapter/crmCatalog.json'
    destination.write_text(json.dumps(catalog, indent=2) + '\n')
    print(f'Generated {len(catalog)} bounded CRM actions')
