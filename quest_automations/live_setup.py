"""Install defaults once. Never overwrite a site's live edits on migration."""
from pathlib import Path
import frappe
from .followup_playbook import DEFAULTS, DOCTYPE

def seed():
    from frappe.custom.doctype.custom_field.custom_field import create_custom_fields
    create_custom_fields({'Quest Meeting Followup': [{'fieldname':'custom_review_panel','label':'Review workspace','fieldtype':'HTML','insert_after':'status'}]}, update=False)
    name = 'Quest Follow-up Review'
    if not frappe.db.exists('Client Script', name):
        script = (Path(__file__).parent / 'live' / 'followup-review.js').read_text()
        frappe.get_doc({'doctype':'Client Script','name':name,'dt':'Quest Meeting Followup','view':'Form','enabled':1,'script':script}).insert(ignore_permissions=True)
    doc = frappe.get_single(DOCTYPE)
    # Seed defaults without owner validation or overwriting any saved field.
    for key, value in DEFAULTS.items():
        if not doc.get(key):
            frappe.db.set_single_value(DOCTYPE, key, value)
