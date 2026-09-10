from pathlib import Path
import json
import frappe
from quest_automations.api import require_access
no_cache=1

def get_context(context):
    require_access()
    from frappe.sessions import get_csrf_token
    context.boot_json=json.dumps({'csrfToken':get_csrf_token()}).replace('<','\\u003c')
    manifest=json.loads(Path(frappe.get_app_path('quest_automations','public','ui','manifest.json')).read_text())
    entry=manifest['index.html'];context.script='/assets/quest_automations/ui/'+entry['file'];context.styles=['/assets/quest_automations/ui/'+p for p in entry.get('css',[])];context.no_cache=1
