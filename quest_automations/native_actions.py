"""Bounded document operations for code actions under the current workflow user."""
import json
import re
import uuid
import frappe
from .core.definition import DefinitionError, require
from .native import json_value

FIELD = re.compile(r'^[A-Za-z_][A-Za-z0-9_]*$')


def find_documents(config):
    require(isinstance(config, dict), 'Document search must be an object')
    require(not set(config) - {'doctype', 'filters', 'fields', 'limit', 'parent'}, 'Unsupported document search option')
    doctype = config.get('doctype')
    require(isinstance(doctype, str) and 0 < len(doctype) <= 200, 'Provide a document type')
    limit = config.get('limit', 100)
    require(type(limit) is int and 1 <= limit <= 1000, 'Search limit must be 1–1000')
    fields = config.get('fields', ['name'])
    require(isinstance(fields, list) and 1 <= len(fields) <= 50 and all(isinstance(f, str) and FIELD.fullmatch(f) for f in fields), 'Choose plain document field names')
    filters = config.get('filters', {})
    require(isinstance(filters, (dict, list)), 'Filters must be an object or list')
    meta = frappe.get_meta(doctype)
    for field in fields:
        require(field in meta.get_valid_columns(), 'Unknown document field')
        df = meta.get_field(field)
        require(not df or df.fieldtype != 'Password', 'Password fields cannot be returned')
    parent = config.get('parent')
    if meta.istable:
        require(isinstance(parent, str) and bool(parent), 'Child-table searches require their parent document type')
        parent_meta = frappe.get_meta(parent)
        require(any(f.fieldtype in ('Table', 'Table MultiSelect') and f.options == doctype for f in parent_meta.fields), 'Invalid child-table parent')
        # The parent type check is not enough: check every returned parent record too.
        from frappe.client import get_list
        rows = get_list(doctype, filters=filters, fields=list(dict.fromkeys(fields + ['parent', 'parenttype'])), parent=parent, limit_page_length=limit, order_by='name asc')
        allowed = {}
        result = []
        for row in rows:
            if row.get('parenttype') != parent:
                continue
            name = row.get('parent')
            if name not in allowed:
                allowed[name] = frappe.get_doc(parent, name).has_permission('read')
            if allowed[name]:
                result.append({field: row.get(field) for field in fields})
    else:
        require(parent is None, 'Parent is only supported for child-table searches')
        result = frappe.get_list(doctype, filters=filters, fields=fields, limit_page_length=limit, order_by='name asc')
    # A truncated search must not be interpreted as absence when matching records.
    require(len(rows if meta.istable else result) < limit, 'Search limit reached; narrow the filters or increase the limit')
    result = json_value(result)
    require(len(json.dumps(result).encode()) <= 1024 * 1024, 'Search response exceeds 1 MB')
    return result


def create_documents(config):
    require(isinstance(config, dict) and set(config) == {'documents'}, 'Provide documents for batch creation')
    documents = config['documents']
    require(isinstance(documents, list) and len(documents) <= 200, 'Create at most 200 documents per action')
    require(len(json.dumps(documents).encode()) <= 1024 * 1024, 'Document batch exceeds 1 MB')
    def check_fields(value):
        if isinstance(value, dict):
            require(not {'flags', 'ignore_permissions', '__proto__', 'constructor', 'prototype', 'docstatus', 'workflow_state'}.intersection(value), 'Protected document fields cannot be set')
            for child in value.values():
                check_fields(child)
        elif isinstance(value, list):
            for child in value:
                check_fields(child)
    check_fields(documents)
    for values in documents:
        require(isinstance(values, dict) and isinstance(values.get('doctype'), str) and bool(values['doctype']), 'Each document requires a document type')
        require(not {'name', 'docstatus', 'workflow_state', 'flags', 'ignore_permissions', 'owner', 'creation', 'modified', 'modified_by'}.intersection(values), 'Protected document fields cannot be set')
        meta = frappe.get_meta(values['doctype'])
        require(not meta.istable and not meta.issingle, 'Create regular documents; include child rows in their parent')
    if not documents:
        return []
    savepoint = 'automation_batch_' + uuid.uuid4().hex
    frappe.db.savepoint(savepoint)
    try:
        # insert() performs normal permission checks and document validation.
        return [frappe.get_doc(values).insert().name for values in documents]
    except Exception:
        # The graph records failures with a checkpoint; roll back partial writes first.
        frappe.db.rollback(save_point=savepoint)
        raise
