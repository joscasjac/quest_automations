"""Regenerate bounded Pulse editor inputs from the companion Pulse checkout."""
import argparse
import ast
import json
from pathlib import Path


def table(path, name):
    values = {}
    for node in ast.parse(path.read_text()).body:
        if isinstance(node, ast.Assign):
            target = node.targets[0]
            if isinstance(target, ast.Name) and target.id == name:
                values.update(ast.literal_eval(node.value))
            elif isinstance(target, ast.Subscript) and isinstance(target.value, ast.Name) and target.value.id == name:
                values[ast.literal_eval(target.slice)] = ast.literal_eval(node.value)
        elif isinstance(node, ast.Expr) and isinstance(node.value, ast.Call):
            call = node.value
            if isinstance(call.func, ast.Attribute) and isinstance(call.func.value, ast.Name) and call.func.value.id == name and call.func.attr == 'update':
                values.update(ast.literal_eval(call.args[0]))
    return values


if __name__ == '__main__':
    parser = argparse.ArgumentParser(); parser.add_argument('--pulse-repo', type=Path, required=True)
    args = parser.parse_args(); root = Path(__file__).resolve().parents[1]
    required = table(root / 'quest_automations/core/definition.py', 'PULSE_ACTIONS')
    allowed = table(args.pulse_repo / 'pulse/api/automation.py', 'ALLOWED')
    catalog = {}
    objects = {'fields', 'field_values'}
    arrays = {'tasks', 'assign', 'unassign', 'assignees', 'pulse_labels', 'exclude', 'approval_statuses', 'rules'}
    checks = {'is_done', 'is_template'}
    numbers = {'limit', 'expected_time', 'pulse_story_points'}
    for action, fields in required.items():
        optional = sorted(set(allowed.get(action.removeprefix('pulse_'), fields)) - set(fields))
        all_fields = list(fields) + optional
        catalog[action] = {'label': 'Pulse: ' + action.removeprefix('pulse_').replace('_', ' '),
            'required': list(fields), 'optional': optional,
            'types': {key: 'object' if key in objects else 'array' if key in arrays else 'boolean' if key in checks else 'number' if key in numbers else 'string' for key in all_fields}}
    destination = root / 'frontend/src/adapter/pulseCatalog.json'
    destination.write_text(json.dumps(catalog, indent=2) + '\n')
    print(f'Generated {len(catalog)} bounded Pulse actions')
