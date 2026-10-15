"""Small, bounded JSON Schema subset for live AI capability definitions."""
import hashlib
import json
import math
import re
from .definition import DefinitionError, require, BLOCKED

KEY = re.compile(r'^[a-z][a-z0-9_-]{0,63}$')
FIELD = re.compile(r'^[A-Za-z_][A-Za-z0-9_]{0,63}$')
TYPES = {'object', 'array', 'string', 'number', 'integer', 'boolean', 'null'}
CREDENTIAL_FIELDS = {'password', 'passwd', 'api_key', 'access_token', 'refresh_token', 'id_token', 'client_secret', 'credential_bundle', 'authorization', 'secret'}
DEFINITION_FIELDS = {'title', 'instructions', 'input_schema', 'output_schema'}

def encoded(value):
    try:
        return json.dumps(value, ensure_ascii=False, sort_keys=True, allow_nan=False, separators=(',', ':'))
    except (TypeError, ValueError, RecursionError):
        raise DefinitionError('Use finite, JSON-compatible values.') from None

def parsed(value, label):
    if isinstance(value, str):
        require(len(value.encode()) <= 45000, label + ' exceeds 45 KB.')
        try:
            value = json.loads(value, parse_constant=lambda _: (_ for _ in ()).throw(ValueError()))
        except (ValueError, RecursionError):
            raise DefinitionError(label + ' must be valid JSON.') from None
    require(len(encoded(value).encode()) <= 45000, label + ' exceeds 45 KB.')
    return value

def schema(value):
    value = parsed(value, 'Schema')
    count = 0
    def check(node, depth=0):
        nonlocal count
        count += 1
        require(depth <= 5 and count <= 100, 'Schema exceeds five levels or 100 fields.')
        require(isinstance(node, dict), 'Each schema field must be an object.')
        require(not set(node) - {'type', 'description', 'enum', 'properties', 'required', 'additionalProperties', 'items'}, 'Unsupported schema keyword. Use the supported simple JSON types.')
        kind = node.get('type')
        require(isinstance(kind, str) and kind in TYPES, 'Choose a supported JSON type.')
        if 'description' in node:
            require(isinstance(node['description'], str) and len(node['description']) <= 1000, 'Field descriptions must be under 1,000 characters.')
        if kind == 'object':
            props = node.get('properties')
            require(isinstance(props, dict) and 1 <= len(props) <= 50, 'Objects need 1–50 named fields.')
            require(node.get('additionalProperties') is False, 'Set additionalProperties to false.')
            require(isinstance(node.get('required'), list) and all(isinstance(key, str) for key in node['required']) and len(node['required']) == len(props) and set(node['required']) == set(props), 'All object fields must be required.')
            require('items' not in node and 'enum' not in node, 'Object schemas cannot have items or enum.')
            for key, child in props.items():
                require(isinstance(key, str) and FIELD.fullmatch(key) and key not in BLOCKED and key.lower() not in CREDENTIAL_FIELDS, 'Use plain field names without credentials or reserved keys.')
                check(child, depth + 1)
        elif kind == 'array':
            require(not {'properties', 'required', 'additionalProperties', 'enum'}.intersection(node), 'Arrays use items only.')
            check(node.get('items'), depth + 1)
        else:
            require(not {'properties', 'required', 'additionalProperties', 'items'}.intersection(node), 'Scalar fields cannot contain object or array options.')
            if 'enum' in node:
                choices = node['enum']
                require(isinstance(choices, list) and 1 <= len(choices) <= 30, 'Use 1–30 enum choices.')
                for choice in choices:
                    validate_value(choice, {k:v for k,v in node.items() if k != 'enum'})
    check(value)
    require(value.get('type') == 'object', 'The root schema must be an object.')
    return value

def validate_value(value, contract, path='input', depth=0):
    require(depth <= 6, path + ': input is too deeply nested.')
    kind = contract['type']
    matches = {'object':isinstance(value, dict), 'array':isinstance(value, list), 'string':isinstance(value, str),
               'number':type(value) in (int, float), 'integer':type(value) is int, 'boolean':type(value) is bool, 'null':value is None}
    require(matches[kind], path + ': expected ' + kind + '.')
    if 'enum' in contract:
        require(any(type(value) is type(c) and value == c for c in contract['enum']), path + ': choose a listed value.')
    if kind == 'object':
        props = contract['properties']
        require(set(value) == set(props), path + ': fields must match the declared schema exactly.')
        for key, child in value.items():
            require(key.lower() not in CREDENTIAL_FIELDS and key not in BLOCKED, 'Credentials and reserved keys are not AI inputs.')
            validate_value(child, props[key], path + '.' + key, depth + 1)
    elif kind == 'array':
        require(len(value) <= 100, path + ': at most 100 items are allowed.')
        for i, child in enumerate(value):
            validate_value(child, contract['items'], path + '.' + str(i), depth + 1)
    elif kind == 'string':
        require(len(value) <= 30000, path + ': text exceeds 30,000 characters.')
    elif kind == 'number':
        require(type(value) is int or math.isfinite(value), path + ': use a finite number.')
    return value

def definition(values):
    require(isinstance(values, dict) and set(values) == DEFINITION_FIELDS, 'Provide title, instructions, input_schema and output_schema only.')
    for key, maximum in [('title', 140), ('instructions', 12000)]:
        require(isinstance(values[key], str) and 0 < len(values[key].strip()) <= maximum, 'Provide valid ' + key + '.')
    result = {'title': values['title'].strip(), 'instructions':values['instructions'].strip(),
              'input_schema':schema(values['input_schema']), 'output_schema':schema(values['output_schema'])}
    require(len(encoded(result).encode()) <= 45000, 'Capability definition exceeds 45 KB.')
    return result

def fingerprint(value):
    return hashlib.sha256(encoded(value).encode()).hexdigest()

def object_schema(properties):
    return {'type':'object', 'properties':properties, 'required':list(properties), 'additionalProperties':False}
