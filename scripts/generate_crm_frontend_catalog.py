"""Regenerate bounded Frappe CRM editor inputs from the companion crm_conversations checkout."""
import argparse
import json
from pathlib import Path

from generate_pulse_frontend_catalog import table


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
    allowed = table(args.crm_repo / 'crm_conversations/api/automation.py', 'ALLOWED')
    catalog = build(required, allowed)
    destination = root / 'frontend/src/adapter/crmCatalog.json'
    destination.write_text(json.dumps(catalog, indent=2) + '\n')
    print(f'Generated {len(catalog)} bounded CRM actions')
