"""Create a draft for human review. Never publishes or runs it."""
import json
import os
from pathlib import Path
from urllib.request import Request, urlopen

site = os.environ['ERPNEXT_SITE'].rstrip('/')
if not site.startswith('https://'):
    raise ValueError('ERPNEXT_SITE must use HTTPS')
definition = json.loads(Path(__file__).with_name('review-draft.json').read_text())
request = Request(
    site + '/api/method/quest_automations.api.dispatch',
    data=json.dumps({'path': 'api/v1/workflows', 'method': 'POST', 'body': {'definition': definition}}).encode(),
    headers={
        'Authorization': 'token ' + os.environ['ERPNEXT_API_KEY'] + ':' + os.environ['ERPNEXT_API_SECRET'],
        'Content-Type': 'application/json',
    },
    method='POST',
)
with urlopen(request, timeout=30) as response:
    result = json.load(response)['message']
if result.get('error'):
    raise RuntimeError(result['error'])
print('Draft created. Review before publishing:')
print(site + '/automations/app/workflows/' + result['id'])
