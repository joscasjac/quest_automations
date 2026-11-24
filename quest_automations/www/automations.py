from pathlib import Path
import json
import frappe
from quest_automations.api import require_access
no_cache=1

def get_context(context):
    require_access()
    from frappe.sessions import get_csrf_token
    from frappe.translate import get_translations_from_apps
    lang=frappe.local.lang or 'en'
    # the SPA reads its Spanish from here before any module runs, so module-level labels translate too
    messages={} if lang.startswith('en') else get_translations_from_apps(lang, apps=['quest_automations'])
    context.lang=lang
    context.boot_json=json.dumps({'csrfToken':get_csrf_token(),'lang':lang,'messages':messages}).replace('<','\\u003c')
    manifest=json.loads(Path(frappe.get_app_path('quest_automations','public','ui','manifest.json')).read_text())
    entry=manifest['index.html'];context.script='/assets/quest_automations/ui/'+entry['file'];context.styles=['/assets/quest_automations/ui/'+p for p in entry.get('css',[])];context.no_cache=1
