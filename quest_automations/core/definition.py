"""Portable workflow contract shared by HTTP handlers and the visual editor.

No ERPNext calls or persistence occur here. References are data paths, never code.
"""
from copy import deepcopy
import re

EVENTS = ('after_insert', 'on_update', 'on_submit', 'on_cancel', 'on_update_after_submit')
ACTIONS = ('get_document', 'create_document', 'update_document', 'apply_workflow', 'condition', 'delay', 'outgoing_webhook')
OPERATORS = ('equals', 'not_equals', 'greater_than', 'less_than', 'contains', 'is_set')
NAME = re.compile(r'^[a-zA-Z][a-zA-Z0-9_-]{0,63}$')
BLOCKED = {'__proto__', 'prototype', 'constructor', '__class__', '__dict__'}


class DefinitionError(ValueError):
    pass


def require(value, message):
    if not value:
        raise DefinitionError(message)


def trigger_list(definition):
    if 'triggers' in definition:
        require('trigger' not in definition, 'Use triggers or legacy trigger, not both')
        triggers = definition['triggers']
    else:
        legacy = definition.get('trigger')
        triggers = [{**legacy, 'id': 'legacy'}] if isinstance(legacy, dict) else []
    require(isinstance(triggers, list) and 1 <= len(triggers) <= 20, 'Provide 1–20 triggers')
    seen = set()
    for trigger in triggers:
        require(isinstance(trigger, dict), 'Each trigger must be an object')
        identifier = trigger.get('id')
        require(isinstance(identifier, str) and NAME.fullmatch(identifier) and identifier not in BLOCKED,
                'Each trigger needs a valid stable ID')
        require(identifier not in seen, 'Duplicate trigger ID')
        allowed = ('manual', 'document_event', 'incoming_webhook', 'record', 'schedule') if definition.get('schemaVersion') == 2 else ('manual', 'document_event', 'incoming_webhook')
        require(trigger.get('kind') in allowed, 'Unsupported trigger')
        seen.add(identifier)
    return triggers


def select_trigger(definition, kind=None, trigger_id=None, payload=None):
    from .graph import event_trigger
    matches = [t for t in trigger_list(definition) if (kind is None or event_trigger(t)['kind'] == kind)
               and (trigger_id is None or t['id'] == trigger_id)]
    if payload is not None and kind == 'document_event':
        matches = [t for t in matches if event_trigger(t).get('doctype') == payload.get('doctype') and event_trigger(t).get('event') == payload.get('event')]
    require(len(matches) == 1, 'Trigger does not match or is ambiguous; provide a matching triggerId')
    return matches[0]


def validate(definition):
    """Return an isolated validated definition, rejecting unsupported behavior."""
    require(isinstance(definition, dict), 'Definition must be an object')
    if definition.get('schemaVersion') == 2:
        from .graph import validate_graph
        return validate_graph(definition)
    require(type(definition.get('schemaVersion')) is int and definition['schemaVersion'] == 1, 'schemaVersion must be 1')
    require(isinstance(definition.get('name'), str) and 0 < len(definition['name'].strip()) <= 200,
            'A name of 1–200 characters is required')
    triggers = trigger_list(definition)
    for trigger in triggers:
        if trigger['kind'] == 'document_event':
            text_field(trigger, 'doctype')
            require(trigger.get('event') in EVENTS, 'Unsupported document event')
    steps = definition.get('steps')
    require(isinstance(steps, list) and 0 < len(steps) <= 100, 'Provide 1–100 steps')
    seen = set()
    for index, step in enumerate(steps):
        require(isinstance(step, dict), f'Step {index + 1} must be an object')
        identifier = step.get('id')
        require(isinstance(identifier, str) and NAME.fullmatch(identifier) and identifier not in BLOCKED,
                'Step IDs must begin with a letter and contain only letters, digits, hyphens, or underscores')
        require(identifier not in seen, f'Duplicate step ID: {identifier}')
        kind = step.get('kind')
        require(kind in ACTIONS, f'Unsupported action: {kind}')
        config = step.get('config')
        require(isinstance(config, dict), f'{identifier}: config must be an object')
        check_references(config, seen)
        if kind in ('get_document', 'create_document', 'update_document', 'apply_workflow'):
            text_field(config, 'doctype')
        if kind in ('get_document', 'update_document', 'apply_workflow'):
            text_or_reference(config, 'name')
        if kind in ('create_document', 'update_document'):
            require(isinstance(config.get('fields'), dict) and config['fields'], f'{identifier}: fields are required')
            require(not {'doctype', 'name', 'docstatus', 'workflow_state'}.intersection(config['fields']),
                    'Use the document type/name configuration and approval actions instead of protected field updates')
        if kind == 'apply_workflow':
            text_field(config, 'action')
        if kind == 'outgoing_webhook':
            require(not any(config.get(k) for k in ('bodyError','headersError','queryError')), 'Correct the request body, headers or query parameters before running')
            text_field(config, 'url')
            require(config.get('method', 'POST') in ('POST', 'PUT', 'PATCH', 'GET', 'DELETE'), 'Unsupported HTTP method')
            require(isinstance(config.get('headers', {}), dict), 'Headers must be an object')
            for key, value in config.get('headers', {}).items():
                require(isinstance(key,str) and '\n' not in key and '\r' not in key,'Invalid header name')
                require((isinstance(value,str) and '\n' not in value and '\r' not in value) or (isinstance(value,dict) and set(value)=={'$ref'}),'Invalid header value')
                require(key.lower() not in ('host', 'content-length', 'connection', 'transfer-encoding'), 'Reserved header')
            require(isinstance(config.get('query',{}),dict),'Query parameters must contain named fields')
            require(config.get('contentType','application/json') in ('application/json','application/x-www-form-urlencoded','text/plain','application/xml'),'Unsupported content type')
            require(type(config.get('saveResponse',True)) is bool,'Save response must be true or false')
            auth=config.get('authorization',{})
            require(isinstance(auth,dict) and auth.get('type','none') in ('none','bearer','basic','api_key'),'Unsupported authorization type')
            if auth.get('type')=='api_key':
                require(auth.get('in','header') in ('header','query'),'Choose header or query for the API key')
                require(isinstance(auth.get('name'),str) and bool(auth['name']),'Provide an API key name')
                require(auth['name'].lower() not in ('host','content-length','connection','transfer-encoding'),'Reserved API key header')
        if kind == 'delay':
            seconds = config.get('seconds')
            require(type(seconds) is int and 1 <= seconds <= 2592000, 'Delay must be 1–2592000 seconds')
        if kind == 'condition':
            require(config.get('operator') in OPERATORS, 'Unsupported condition operator')
            require('left' in config, 'Condition left operand is required')
            require(config['operator'] == 'is_set' or 'right' in config, 'Condition right operand is required')
            require(config.get('onFalse', 'stop') == 'stop', 'Version 1 conditions stop the run when false')
        seen.add(identifier)
    return deepcopy(definition)


def text_field(obj, key):
    require(isinstance(obj.get(key), str) and 0 < len(obj[key].strip()) <= 200, f'{key} must be a nonempty string')


def text_or_reference(obj, key):
    value = obj.get(key)
    if isinstance(value, dict):
        require(set(value) == {'$ref'}, f'{key} must be text or a reference')
    else:
        text_field(obj, key)


def reference_parts(path):
    require(isinstance(path, str) and 0 < len(path) < 512, 'Invalid reference')
    parts = path.split('.')
    require(all(p and p not in BLOCKED for p in parts), 'Unsafe or empty reference segment')
    require(parts[0] in ('trigger', 'steps'), 'References must start with trigger or steps')
    require(parts[0] != 'steps' or len(parts) >= 3, 'Step references require a step ID and output path')
    return parts


def check_references(value, earlier_steps, depth=0):
    require(depth <= 30, 'Configuration nesting exceeds 30 levels')
    if isinstance(value, dict):
        require(not BLOCKED.intersection(value), 'Unsafe configuration key')
        if '$ref' in value:
            require(set(value) == {'$ref'}, 'References cannot include other keys')
            parts = reference_parts(value['$ref'])
            require(parts[0] != 'steps' or parts[1] in earlier_steps, 'Reference must point to an earlier step')
        else:
            for child in value.values():
                check_references(child, earlier_steps, depth + 1)
    elif isinstance(value, list):
        for child in value:
            check_references(child, earlier_steps, depth + 1)
    else:
        require(value is None or type(value) in (str, int, float, bool), 'Configuration must contain JSON values')


def resolve(value, context):
    """Resolve references preserving numbers, lists, objects, and null values."""
    if isinstance(value, dict):
        if '$ref' in value:
            current = context
            for part in reference_parts(value['$ref']):
                if isinstance(current, dict) and part in current:
                    current = current[part]
                elif isinstance(current, list) and part.isdigit() and int(part) < len(current):
                    current = current[int(part)]
                else:
                    raise DefinitionError(f'Missing input: {value["$ref"]}')
            return deepcopy(current)
        return {key: resolve(child, context) for key, child in value.items()}
    if isinstance(value, list):
        return [resolve(child, context) for child in value]
    return value


def evaluate_condition(config):
    left, right = config['left'], config.get('right')
    operator = config['operator']
    if operator == 'is_set':
        return left is not None and left != ''
    if operator == 'equals':
        return type(left) is type(right) and left == right
    if operator == 'not_equals':
        return not evaluate_condition({**config, 'operator': 'equals'})
    if operator in ('greater_than', 'less_than'):
        require(type(left) in (int, float) and type(right) in (int, float), 'Numeric comparison requires numbers')
        return left > right if operator == 'greater_than' else left < right
    if operator == 'contains':
        require(isinstance(left, (str, list)), 'Contains requires a string or list')
        require(not isinstance(left, str) or isinstance(right, str), 'String contains requires string operands')
        return right in left
    raise DefinitionError('Unsupported condition operator')
