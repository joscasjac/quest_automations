"""The AI sidebar in the workflow editor, a copilot for the workflow on screen.

One turn is the person's message plus the workflow exactly as the editor holds it, unsaved
edits included. The model answers with a short reply and a list of typed operations. Every
operation is checked here and simulated on a copy of the workflow, and what comes back is the
workflow it would produce. The editor applies that in one step, so one Undo takes the whole
turn back. Nothing is saved here.

The model never writes workflow JSON. New triggers and steps are written in the builder's plan
language (builder.PLAN_GUIDE) and compiled by builder.Compiler, so they get the same checks,
the same "AI text goes to a person first" rule and the same AI steps as the Build with AI page.
Existing steps get stable handles (s1, s2…) for this turn, and references between steps are
renumbered when steps move, so an earlier AI result keeps reaching the steps that use it.

Model calls go through FAC Model Bridge. The person picks the model (and its effort) in the
sidebar; otherwise the app's default model answers. Turns run as background jobs (the "ai"
queue when the bench has one, else "long") because production cuts HTTP requests at 120s; the
browser polls for the result and sees the reply as it streams when the provider streams."""
import copy
import json
import re
import time

import frappe
from frappe import _

from . import builder
from .core.definition import DefinitionError

MAX_OPS = 20
HISTORY_TURNS = 10
CACHE_TTL = 1800
PREF_MODEL = 'quest_automations_copilot_model'
PREF_EFFORT = 'quest_automations_copilot_effort'
REF = re.compile(r'(steps\.step_)(\d+)')
TRANSIENT = (None, 500, 502, 503, 504, 529)


class OpError(DefinitionError):
	"""An operation can't be applied; the message goes back to the model or to the person."""


# ------------------------------------------------------------------ models


def _bridge():
	try:
		return 'fac_model_bridge' in frappe.get_installed_apps() and bool(frappe.db.exists('DocType', 'Model Connection'))
	except Exception:
		return False


def _choices():
	if not _bridge() or frappe.session.user == 'Guest':
		return []
	from fac_model_bridge.choices import available_choices

	try:
		return available_choices()
	except frappe.PermissionError:
		frappe.clear_last_message()
		return []


def _app_default():
	"""The app's default model (Quest ChatGPT Connection), else the site's (Model Bridge Settings)."""
	name = None
	settings = 'Quest ChatGPT Connection'
	try:
		if frappe.db.exists('DocType', settings) and frappe.get_meta(settings).has_field('model_connection'):
			name = frappe.db.get_single_value(settings, 'model_connection')
		if not name:
			from fac_model_bridge.connections import default_connection

			name = default_connection()
	except Exception:
		name = None
	return name


def _pick(choices=None):
	"""(the choice that answers, the one the person pinned or '')."""
	choices = _choices() if choices is None else choices
	by_name = {c['name']: c for c in choices}
	pinned = frappe.defaults.get_user_default(PREF_MODEL) or ''
	if pinned not in by_name:
		pinned = ''
	for name in (pinned, _app_default()):
		if name and name in by_name:
			return by_name[name], pinned
	return (choices[0] if choices else None), pinned


def _effort(choice):
	effort = frappe.defaults.get_user_default(PREF_EFFORT) or 'default'
	return effort if choice and effort in (choice.get('reasoning_efforts') or []) else 'default'


def _public(choice):
	keys = ('name', 'label', 'model', 'provider', 'reasoning_efforts', 'tier')
	return {k: choice.get(k) for k in keys} if choice else None


@frappe.whitelist(methods=['GET'])
def status():
	"""What the sidebar shows about its model. Never returns a credential."""
	builder._guard()
	choices = _choices()
	active, pinned = _pick(choices)
	return {
		'configured': active is not None,
		'bridge_installed': _bridge(),
		'setup_url': '/ai',
		'models': [_public(c) for c in choices],
		'selected': pinned,
		'active': _public(active),
		'effort': _effort(active),
		'lang': builder._lang(),
	}


@frappe.whitelist(methods=['POST'])
def set_model(connection='', reasoning_effort='default'):
	"""Change only this person's sidebar model, never a connection or its credentials."""
	builder._guard()
	name = str(connection or '')
	choices = _choices()
	if name and name not in {c['name'] for c in choices}:
		frappe.throw(_('Choose a model that is available to you.'), frappe.PermissionError)
	frappe.defaults.set_user_default(PREF_MODEL, name)
	active, _pinned = _pick(choices)
	effort = str(reasoning_effort or 'default')
	if effort != 'default' and effort not in ((active or {}).get('reasoning_efforts') or []):
		frappe.throw(_('This model does not offer that thinking level.'))
	frappe.defaults.set_user_default(PREF_EFFORT, effort)
	return status()


def _ask(system, user, on_text=None):
	"""One JSON object from the person's model."""
	from fac_model_bridge.choices import resolve_choice
	from fac_model_bridge.connections import credentials
	from fac_model_bridge.providers import ProviderError, request_completion
	from fac_model_bridge.usage import source as usage_source

	choice, _pinned = _pick()
	if not choice:
		raise DefinitionError(_('Choose an AI model in the AI Command Center (/ai) first.'))
	effort = _effort(choice)
	conn = resolve_choice(choice['name'])  # the bridge's own access rules
	messages = [{'role': 'system', 'content': system}, {'role': 'user', 'content': user}]
	problem = None
	for wait in (1.5, 4.0, None):
		try:
			with usage_source('Quest Automations: AI sidebar'):
				token, account_id = credentials(conn.name)
				reply = request_completion(conn.provider, conn.model, token, messages, [],
					subscription=conn.authentication == 'Subscription', account_id=account_id,
					on_text=on_text, reasoning_effort=None if effort == 'default' else effort)
			break
		except ProviderError as error:
			problem = error
			if error.status in TRANSIENT and wait:
				time.sleep(wait)
				continue
			if error.status == 429:
				raise DefinitionError(_('Your model provider says the usage limit is reached. Try again later or pick another model.')) from None
			if error.status in (401, 403):
				raise DefinitionError(_('Your model provider rejected the connection. Reconnect it in the AI Command Center (/ai).')) from None
			raise DefinitionError(_('Your model provider did not answer. Wait a minute and try again.')) from None
		except Exception as error:
			if error.__class__.__name__ == 'UsageLimitReached':
				raise DefinitionError(str(error)[:300]) from None
			raise
	else:
		raise DefinitionError(_('Your model provider did not answer. Wait a minute and try again.')) from problem
	text = (reply.text or '').strip()
	start, end = text.find('{'), text.rfind('}')
	try:
		value = json.loads(text[start:end + 1])
	except ValueError:
		raise DefinitionError(_('The AI returned an unreadable answer. Try rephrasing.')) from None
	if not isinstance(value, dict):
		raise DefinitionError(_('The AI returned an unreadable answer. Try rephrasing.'))
	return value


# ------------------------------------------------------------------ the workflow on screen


def _plain(text, limit=400):
	"""Copy a person reads: no dashes used as punctuation, no runs of spaces."""
	text = re.sub(r'\s*[—–]\s*', ', ', str(text or '').strip())
	return re.sub(r'[ \t]{2,}', ' ', text)[:limit]


def _doctype_of(trigger):
	kind = (trigger or {}).get('kind')
	if kind in ('document_event', 'crm'):
		return trigger.get('doctype')
	if kind == 'record':
		from .core.graph import ENTITIES

		return ENTITIES.get(trigger.get('entityType'))
	return None


def _config(step):
	try:
		value = json.loads(step.get('configJson') or '{}')
	except ValueError:
		return {}
	return value if isinstance(value, dict) else {}


def _is_ai(step):
	return step.get('kind') == 'run_ai_capability' or (step.get('kind') == 'erpnext' and step.get('operation') == 'run_ai_capability')


def _ai_results(step):
	key = _config(step).get('capability')
	if not key or not frappe.db.exists(builder.CAPABILITY, key):
		return set()
	raw = frappe.db.get_value(builder.CAPABILITY, key, 'output_schema')
	try:
		return set((json.loads(raw or '{}').get('properties') or {}).keys())
	except ValueError:
		return set()


def _walk(value, fn):
	"""Apply fn to every string inside a step, configJson included."""
	if isinstance(value, str):
		return fn(value)
	if isinstance(value, list):
		return [_walk(v, fn) for v in value]
	if isinstance(value, dict):
		return {k: _walk(v, fn) for k, v in value.items()}
	return value


class Workflow:
	"""The workflow being changed, with a stable handle per trigger and top-level step."""

	def __init__(self, raw):
		raw = frappe.parse_json(raw) if isinstance(raw, str) else (raw or {})
		self.name = str(raw.get('name') or '')
		self.description = str(raw.get('description') or '')
		self.triggers = [t for t in (raw.get('triggers') or []) if isinstance(t, dict) and t.get('kind')]
		self.steps = [s for s in (raw.get('steps') or []) if isinstance(s, dict) and s.get('kind')]
		self.t_handles = ['t%d' % (i + 1) for i in range(len(self.triggers))]
		self.handles = ['s%d' % (i + 1) for i in range(len(self.steps))]
		self.results = {h: _ai_results(s) for h, s in zip(self.handles, self.steps) if _is_ai(s)}
		self.counter = len(self.steps)

	def doctype(self):
		return _doctype_of(self.triggers[0]) if self.triggers else None

	def index(self, handle, what='step'):
		handles = self.handles if what == 'step' else self.t_handles
		handle = str(handle or '').strip()
		if handle not in handles:
			raise OpError('There is no %s "%s". Use a handle from the list.' % (what, handle))
		return handles.index(handle)

	def has_ai(self):
		def any_ai(items):
			for s in items:
				if _is_ai(s):
					return True
				if s.get('kind') == 'if_else' and (any(any_ai(b.get('steps') or []) for b in s.get('branches') or []) or any_ai(s.get('elseSteps') or [])):
					return True
			return False

		return any_ai(self.steps)

	def renumber(self, mapping):
		"""Rewrite steps.step_N references and Go To targets after steps moved. mapping: old → new
		(None when the step is gone); a reference to a removed step is refused."""
		broken = []

		def fix(text):
			def one(m):
				new = mapping.get(int(m[2]), int(m[2]))
				if new is None:
					broken.append(m[0])
					return m[0]
				return m[1] + str(new)

			return REF.sub(one, text)

		steps = [_walk(s, fix) for s in self.steps]

		def target(items):
			for s in items:
				if s.get('kind') == 'go_to' and isinstance(s.get('targetStepIndex'), int):
					new = mapping.get(s['targetStepIndex'], s['targetStepIndex'])
					if new is None:
						broken.append('go_to')
					else:
						s['targetStepIndex'] = new
				if s.get('kind') == 'if_else':
					for b in s.get('branches') or []:
						target(b.get('steps') or [])
					target(s.get('elseSteps') or [])

		target(steps)
		if broken:
			raise OpError('Another step still uses that step (%s). Change or remove that step first.' % broken[0])
		self.steps = steps

	def compiler(self, plan_steps=()):
		"""builder.Compiler for steps written in the plan language, against this workflow."""
		c = builder.Compiler({'status': 'ready', 'trigger': {'type': 'manual'}, 'steps': list(plan_steps)})
		c.doctype = self.doctype()
		c.has_ai = c.has_ai or self.has_ai()
		for i, (h, s) in enumerate(zip(self.handles, self.steps)):
			if h in self.results:
				c.ai[h] = (i, self.results[h])
			elif s.get('kind') == 'erpnext' and s.get('operation') == 'reservas_booking_link':
				c.links[h] = i
		return c

	def definition(self):
		return {'schemaVersion': 2, 'name': self.name, 'description': self.description or None,
			'triggers': self.triggers, 'steps': self.steps}

	def digest(self):
		"""What the model is told: enough to reason about each step, nothing it could mistake for data."""
		triggers = [{'handle': h, **_brief_trigger(t)} for h, t in zip(self.t_handles, self.triggers)]
		steps = []
		for i, (h, s) in enumerate(zip(self.handles, self.steps)):
			d = {'handle': h, **_brief_step(s)}
			if h in self.results:
				d['results'] = sorted(self.results[h])
				d['use_results_as'] = '{{%s.<result>}}' % h
			steps.append(d)
		return {'name': self.name, 'description': self.description, 'triggers': triggers, 'steps': steps}


def _brief_trigger(t):
	kind = t.get('kind')
	d = {'kind': kind}
	if kind in ('document_event', 'crm'):
		d['record_type'] = t.get('doctype')
		if kind == 'document_event':
			d['event'] = {'after_insert': 'created', 'on_update': 'changed'}.get(t.get('event'), t.get('event'))
		if t.get('changedFields'):
			d['only_when_these_change'] = t['changedFields']
	elif kind == 'schedule':
		d['every_minutes'] = t.get('intervalMinutes')
	elif kind == 'record':
		d['record_type'] = _doctype_of(t)
		d['event'] = t.get('event')
	if t.get('condition'):
		d['only_if'] = t['condition']
	return d


def _brief_step(s, depth=0):
	kind = s.get('kind')
	d = {'kind': 'ai' if _is_ai(s) else kind, 'label': str(s.get('label') or '')[:160]}
	if kind == 'wait':
		d['minutes'] = s.get('durationMinutes')
	elif kind == 'send_email':
		d.update(to=s.get('to'), subject=str(s.get('subject') or '')[:200], body=re.sub(r'<[^>]+>', ' ', str(s.get('body') or ''))[:400])
	elif kind in ('send_notification', 'log'):
		d['message'] = str(s.get('message') or '')[:300]
	elif kind == 'if_else':
		d['branches'] = [{'name': b.get('name'), 'when': {k: b.get(k) for k in ('field', 'operator', 'value', 'match', 'conditions') if b.get(k) is not None},
			'steps': [_brief_step(c, depth + 1) for c in b.get('steps') or []]} for b in s.get('branches') or []]
		d['otherwise'] = [_brief_step(c, depth + 1) for c in s.get('elseSteps') or []]
	elif kind == 'go_to':
		d['goes_to_step_number'] = (s.get('targetStepIndex') or 0) + 1
	elif _is_ai(s):
		d['reads'] = sorted((_config(s).get('input') or {}).keys())
	elif kind in ('erpnext', 'api_request', 'outgoing_webhook', 'get_document'):
		d['operation'] = s.get('operation') or kind
		config = json.dumps(_config(s), ensure_ascii=False, default=str)
		d['settings'] = config[:500] + ('…' if len(config) > 500 else '')
	elif kind == 'custom_code':
		d['code_lines'] = len(str(s.get('code') or '').splitlines())
	return d


# ------------------------------------------------------------------ operations


class Turn:
	def __init__(self, workflow):
		self.w = workflow
		self.changes = []
		self.notes = []
		self.errors = []
		self.capabilities = []

	def done(self, op, fallback):
		self.changes.append(_plain(op.get('label') or fallback, 160))

	def compiled(self, compiler):
		self.capabilities += compiler.capabilities
		self.notes += compiler.notes
		compiler.capabilities, compiler.notes = [], []

	def new_handle(self, plan_step):
		self.w.counter += 1
		sid = plan_step.get('id') if isinstance(plan_step, dict) else None
		return sid if isinstance(sid, str) and builder.STEP_ID.fullmatch(sid) and sid not in self.w.handles else 's%d' % self.w.counter


def _plan_steps(op, key='steps'):
	steps = op.get(key)
	if isinstance(steps, dict):
		steps = [steps]
	if not isinstance(steps, list) or not steps or not all(isinstance(s, dict) for s in steps):
		raise OpError('"%s" needs a list of steps in the plan language.' % key)
	return steps


def _splice(turn, position, plan_steps, replace=False):
	"""Compile plan steps and put them at `position` (in place of the step there when `replace`),
	renumbering every reference to the steps that move. A replaced AI step keeps the steps that
	read its results only when the new one is a single AI step giving at least the same results."""
	w = turn.w
	k = len(plan_steps)
	old = w.handles[position] if replace else None
	keep = replace and old in w.results and k == 1 and plan_steps[0].get('type') == 'ai'
	mapping = {}
	for j in range(len(w.steps)):
		if j < position:
			mapping[j] = j
		elif replace and j == position:
			mapping[j] = position if keep else None
		else:
			mapping[j] = j - (1 if replace else 0) + k
	try:
		w.renumber(mapping)
	except OpError:
		raise OpError('Other steps use the results of that step. Replace it with one AI step that gives the same results, or change those steps too.') from None
	c = w.compiler(plan_steps)
	c.ai = {h: (mapping[i], r) for h, (i, r) in c.ai.items() if h != old}
	c.links = {h: mapping[i] for h, i in c.links.items() if h != old}
	old_results = w.results.pop(old, None) if replace else None
	compiled, handles = [], []
	for n, s in enumerate(plan_steps):
		compiled.append(c.step(copy.deepcopy(s), position + n))
		handle = old if keep else turn.new_handle(s)
		handles.append(handle)
		if s.get('type') == 'ai':
			w.results[handle] = {g.get('name') for g in s.get('get') or [] if isinstance(g, dict)}
	if keep and (old_results or set()) - w.results[old]:
		raise OpError('The new AI step must still give %s, which later steps use.' % ', '.join(sorted(old_results - w.results[old])))
	w.steps[position:position + (1 if replace else 0)] = compiled
	w.handles[position:position + (1 if replace else 0)] = handles
	turn.compiled(c)


def _op_add_steps(turn, op):
	w, after = turn.w, op.get('after')
	plan = _plan_steps(op)
	if after in (None, '', 'end'):
		position = len(w.steps)
	elif after == 'start':
		position = 0
	else:
		position = w.index(after) + 1
	_splice(turn, position, plan)
	turn.done(op, _('Added {0} steps').format(len(plan)))


def _op_replace_step(turn, op):
	_splice(turn, turn.w.index(op.get('step')), _plan_steps(op, 'with'), replace=True)
	turn.done(op, _('Changed a step'))


EDITABLE = {
	'send_email': ('to', 'subject', 'body'),
	'send_notification': ('message',),
	'log': ('message',),
}


def _op_edit_step(turn, op):
	"""Small changes to one existing step: its name, a wait's length, an email's words, a record's fields."""
	w = turn.w
	i = w.index(op.get('step'))
	step = copy.deepcopy(w.steps[i])
	c = w.compiler()
	values = op.get('set') if isinstance(op.get('set'), dict) else {}
	changed = False
	if op.get('label'):
		step['label'] = _plain(op['label'], 140)
		changed = True
	kind = step.get('kind')
	if kind == 'wait' and values:
		unit = values.get('unit')
		amount = values.get('amount')
		if unit not in builder.UNITS or not isinstance(amount, (int, float)) or amount <= 0:
			raise OpError('A wait needs "amount" and "unit" (minutes, hours, days or weeks).')
		step['durationMinutes'] = min(525600, amount * builder.UNITS[unit])
		changed = True
	elif kind in EDITABLE and values:
		for key in EDITABLE[kind]:
			if key in values:
				text = c.text(values[key])
				step[key] = text.replace('\n', '<br>') if key == 'body' else text
				changed = True
	elif kind == 'erpnext' and values:
		config = _config(step)
		operation = step.get('operation')
		if operation in ('create_document', 'update_document') and isinstance(config.get('fields'), dict):
			meta = frappe.get_meta(config.get('doctype'))
			for field, value in values.items():
				if not meta.has_field(field) or field in ('docstatus', 'workflow_state'):
					raise OpError(builder._t('unknown_field', field, config.get('doctype')))
				config['fields'][field] = c.text(value)
			changed = True
		elif operation in ('crm_send_email', 'crm_send_sms'):
			for key in ('subject', 'body'):
				if key in values:
					config[key] = c.text(values[key]).replace('\n', '<br>') if operation == 'crm_send_email' and key == 'body' else c.text(values[key])
					changed = True
		else:
			raise OpError('That step can only be renamed here. Use replace_step to change what it does.')
		step['configJson'] = json.dumps(config, ensure_ascii=False)
	elif values:
		raise OpError('That step can only be renamed here. Use replace_step to change what it does.')
	if not changed:
		return
	if w.has_ai() and kind == 'send_email':
		raise OpError(builder._t('review_instead'))
	w.steps[i] = step
	turn.done(op, _('Changed {0}').format(step.get('label') or kind))


def _op_remove_step(turn, op):
	w = turn.w
	i = w.index(op.get('step'))
	label = w.steps[i].get('label')
	w.renumber({j: (j if j < i else None if j == i else j - 1) for j in range(len(w.steps))})
	del w.steps[i]
	w.results.pop(w.handles.pop(i), None)
	turn.done(op, _('Removed {0}').format(label or _('a step')))


def _op_move_step(turn, op):
	w = turn.w
	i = w.index(op.get('step'))
	after = op.get('after')
	if after == 'start':
		target = 0
	elif after in (None, '', 'end'):
		target = len(w.steps) - 1
	else:
		j = w.index(after)
		target = j if j > i else j + 1
	if target == i:
		return
	order = list(range(len(w.steps)))
	order.insert(target, order.pop(i))
	label = w.steps[i].get('label')
	w.renumber({o: n for n, o in enumerate(order)})
	w.steps = [w.steps[o] for o in order]
	w.handles = [w.handles[o] for o in order]
	turn.done(op, _('Moved {0}').format(label or _('a step')))


def _check_order(w):
	"""Every step may only read results of steps before it (an "if" also of its own branches)."""
	for p, s in enumerate(w.steps):
		text = json.dumps(s, ensure_ascii=False)
		for m in REF.finditer(text):
			n = int(m[2])
			if n > p or (n == p and s.get('kind') != 'if_else'):
				raise OpError('"%s" would read results of a step that comes after it.' % (s.get('label') or s.get('kind')))


def _compile_trigger(turn, plan_trigger):
	if not isinstance(plan_trigger, dict):
		raise OpError('"trigger" needs a trigger in the plan language.')
	c = builder.Compiler({'status': 'ready', 'trigger': plan_trigger, 'steps': []})
	return c.compile_trigger()


def _check_steps_fit(turn):
	"""A new record type must still have the fields the steps read."""
	doctype = turn.w.doctype()
	if not doctype:
		return
	meta = frappe.get_meta(doctype)
	fields = set(re.findall(r'{{\s*trigger\.([A-Za-z_][A-Za-z0-9_]*)', json.dumps(turn.w.steps)))
	missing = [f for f in fields if f not in builder.STANDARD_FIELDS and not meta.has_field(f)]
	if missing:
		turn.notes.append(_('Some steps read fields that {0} does not have: {1}. Check those steps.').format(doctype, ', '.join(sorted(missing))))


def _op_set_trigger(turn, op):
	w = turn.w
	trigger = _compile_trigger(turn, op.get('trigger'))
	if w.triggers:
		i = w.index(op.get('trigger_handle') or w.t_handles[0], 'trigger')
		trigger['id'] = w.triggers[i].get('id') or trigger['id']
		w.triggers[i] = trigger
	else:
		w.triggers.append(trigger)
		w.t_handles.append('t1')
	_check_steps_fit(turn)
	turn.done(op, _('Changed when it starts'))


def _op_add_trigger(turn, op):
	w = turn.w
	trigger = _compile_trigger(turn, op.get('trigger'))
	trigger['id'] = 'trigger_' + frappe.generate_hash(length=8)
	if w.triggers and _doctype_of(w.triggers[0]) and _doctype_of(trigger) not in (None, _doctype_of(w.triggers[0])):
		raise OpError('Every trigger must start from the same record type as the first one.')
	w.triggers.append(trigger)
	w.t_handles.append('t%d' % (len(w.t_handles) + 1))
	turn.done(op, _('Added another way to start it'))


def _op_remove_trigger(turn, op):
	w = turn.w
	i = w.index(op.get('trigger_handle'), 'trigger')
	del w.triggers[i]
	del w.t_handles[i]
	turn.done(op, _('Removed a trigger'))


def _op_rename(turn, op):
	name = _plain(op.get('name'), 200)
	if name and name != turn.w.name:
		turn.w.name = name
		turn.done(op, _('Renamed it to {0}').format(name))


def _op_describe(turn, op):
	text = _plain(op.get('description'), 1000)
	if text and text != turn.w.description:
		turn.w.description = text
		turn.done(op, _('Changed the description'))


OPERATIONS = {
	'add_steps': _op_add_steps,
	'replace_step': _op_replace_step,
	'edit_step': _op_edit_step,
	'remove_step': _op_remove_step,
	'move_step': _op_move_step,
	'set_trigger': _op_set_trigger,
	'add_trigger': _op_add_trigger,
	'remove_trigger': _op_remove_trigger,
	'rename': _op_rename,
	'describe': _op_describe,
	'explain': lambda turn, op: None,
}


# ------------------------------------------------------------------ prompt


def _vocabulary():
	guide = builder.PLAN_GUIDE.replace('BOOKING_EVENTS', ', '.join(builder.BOOKING_EVENTS))
	return guide[guide.index('TRIGGER, one of:'):]


GUIDE = '''OPERATIONS (use only these; each is a JSON object with "op" and "label"):
- {"op":"add_steps","after":"<step handle>" | "start" | "end","steps":[<plan steps>]}
- {"op":"replace_step","step":"<handle>","with":[<plan steps>]}  Rewrites one step (an "if" with its branches included).
- {"op":"edit_step","step":"<handle>","label":"...","set":{...}}  Small edits that keep the step:
    wait: {"amount":2,"unit":"days"}; email: to, subject, body; notification or log: message;
    a "create_document"/"update_document" step: record fields to set; crm_send_email: subject, body; crm_send_sms: body.
- {"op":"remove_step","step":"<handle>"}
- {"op":"move_step","step":"<handle>","after":"<handle>" | "start" | "end"}
- {"op":"set_trigger","trigger_handle":"t1","trigger":{<plan trigger>}}  Change when it starts (adds one when there is none).
- {"op":"add_trigger","trigger":{<plan trigger>}}  Another way to start it, same record type.
- {"op":"remove_trigger","trigger_handle":"t2"}
- {"op":"rename","name":"..."}   {"op":"describe","description":"..."}
- {"op":"explain"}  They asked a question about the workflow, not for a change: answer it in "reply".

Steps and triggers are written in the PLAN language below. In plan text, {{record.<field>}} is the record
that started the workflow, and an existing AI step's results are {{<its handle>.<result>}} (only steps before it).

RULES
- "label" on every operation: one short line telling the person what it does, in THEIR language. Name steps by
  what they do, never by handle, and never mention handles, JSON, capabilities or schemas to the person.
- "reply": one to three short sentences in THEIR language. THEIR language is Spanish (neutral, "usted") when they
  wrote Spanish, English when they wrote English, and FALLBACK otherwise. Never use the em dash.
- Change only what they asked. Keep every other step exactly as it is.
- Use only handles from the workflow. Never invent one.
- Words like this, it, esto, este, esta mean the selected step or trigger when one is selected.
- When the message is ambiguous in a way that changes the result, return instead
  {"clarify":"<one short question in their language>","options":["<2 to 4 short answers>"]}.
- A greeting or thanks needs no operations: an empty list and a reply.
- Add 2 or 3 "suggestions": short next requests, in their language, that would genuinely improve THIS workflow.

Respond with ONLY JSON: {"reply":"...","operations":[...],"suggestions":[...]}

PLAN LANGUAGE
'''


def _prompt(w, prompt, history, selected, answered, error=None):
	fallback = 'Spanish' if builder._lang() == 'es' else 'English'
	knowledge = builder._knowledge(prompt + ' ' + (w.doctype() or ''), {'trigger': {'doctype': w.doctype()}} if w.doctype() else None)
	system = ('You are the AI assistant inside Quest Automations, the automation builder of a Frappe/ERPNext business '
		'system. The person is editing the workflow below in the visual editor. Turn their message into a short reply and '
		'a list of operations that the editor applies once they confirm.\n\n' + GUIDE.replace('FALLBACK', fallback) + _vocabulary())
	focus = ''
	if selected:
		focus = 'The person has selected %s. ' % selected
	message = {
		'today': frappe.utils.nowdate(),
		'workflow': w.digest(),
		'what_you_can_use': knowledge,
	}
	text = json.dumps(message, ensure_ascii=False, default=str)
	if history:
		text += '\n\nConversation so far:\n' + '\n'.join('%s: %s' % (h.get('role', 'user'), str(h.get('text', ''))[:400]) for h in history)
	if focus:
		text += '\n\n' + focus + 'Change only it unless they clearly mean the whole workflow.'
	if answered:
		text += '\n\nThe person has just answered your question. Act on it now and do not ask again.'
	text += '\n\nMessage: ' + prompt
	if error:
		text += '\n\nYour last operations could not be used: ' + error + ' Fix them and answer again with the whole list.'
	return system, text


def _selected(w, raw):
	sel = frappe.parse_json(raw) if isinstance(raw, str) else raw
	if not isinstance(sel, dict):
		return None
	try:
		if sel.get('type') == 'trigger' and 0 <= int(sel.get('index')) < len(w.triggers):
			return 'the trigger %s' % w.t_handles[int(sel['index'])]
		if sel.get('type') == 'step' and 0 <= int(sel.get('index')) < len(w.steps):
			i = int(sel['index'])
			return 'the step %s ("%s")' % (w.handles[i], w.steps[i].get('label'))
		if sel.get('type') == 'branchStep' and 0 <= int(sel.get('stepIndex')) < len(w.steps):
			i = int(sel['stepIndex'])
			return 'a step inside the "if" %s ("%s"); change it with replace_step on %s' % (w.handles[i], w.steps[i].get('label'), w.handles[i])
	except (TypeError, ValueError):
		return None
	return None


# ------------------------------------------------------------------ one turn


def _simulate(raw, plan):
	"""Apply the model's operations to a fresh copy. Returns (turn, first error)."""
	from .core.graph import validate_graph

	turn = Turn(Workflow(raw))
	first = None
	for op in (plan.get('operations') or [])[:MAX_OPS]:
		if not isinstance(op, dict):
			continue
		handler = OPERATIONS.get(op.get('op'))
		if not handler:
			first = first or 'Unknown operation "%s".' % op.get('op')
			continue
		snapshot = copy.deepcopy((turn.w.__dict__, turn.changes, turn.notes, turn.capabilities))
		try:
			handler(turn, op)
			_check_order(turn.w)
		except DefinitionError as error:
			turn.w.__dict__.update(snapshot[0])
			turn.changes, turn.notes, turn.capabilities = snapshot[1], snapshot[2], snapshot[3]
			turn.errors.append(_plain(op.get('label') or op.get('op'), 160) + ': ' + str(error)[:300])
			first = first or str(error)
	if turn.changes:
		try:
			validate_graph(turn.w.definition())
		except DefinitionError as error:
			first = first or str(error)
			turn.errors.append(str(error)[:300])
			turn.invalid = True
	return turn, first


def run_turn(prompt, workflow, history=None, selected=None, answered=False, progress=None):
	progress = progress or (lambda **kw: None)
	prompt = str(prompt or '').strip()
	if not prompt:
		raise DefinitionError(_('Type a request first.'))
	if len(prompt) > 4000:
		raise DefinitionError(_('That message is too long. Keep it under 4,000 characters.'))
	raw = frappe.parse_json(workflow) if isinstance(workflow, str) else (workflow or {})
	before = Workflow(raw)
	history = [h for h in (frappe.parse_json(history or '[]') or []) if isinstance(h, dict)][-HISTORY_TURNS:]
	answered = frappe.parse_json(answered) if isinstance(answered, str) else bool(answered)
	focus = _selected(before, selected)

	streamed = {'text': '', 'at': 0.0}

	def on_text(chunk):
		streamed['text'] += chunk or ''
		now = time.monotonic()
		if now - streamed['at'] > 0.35:
			streamed['at'] = now
			partial = _partial_reply(streamed['text'])
			if partial:
				progress(stage=_('Writing…'), partial=partial)

	error = None
	for attempt in range(2):
		progress(stage=_('Thinking…') if not attempt else _('Fixing the changes…'))
		system, user = _prompt(before, prompt, history, focus, answered, error)
		streamed['text'] = ''
		plan = _ask(system, user, on_text)
		if plan.get('clarify') and not answered:
			return {'clarify': _plain(plan['clarify'], 300),
				'options': [_plain(o, 80) for o in plan.get('options') or [] if isinstance(o, str)][:4]}
		progress(stage=_('Checking the changes…'), partial=_plain(plan.get('reply'), 600))
		turn, error = _simulate(raw, plan)
		if not error:
			break
	invalid = getattr(turn, 'invalid', False)
	notes = list(dict.fromkeys(turn.notes))
	if turn.errors:
		notes += [_('Not done: {0}').format(e) for e in turn.errors]
	if turn.capabilities and not builder.ai_ready():
		notes.append(builder._t('ai_needs_update'))
	changed = not invalid and json.dumps(before.definition(), sort_keys=True, default=str) != json.dumps(turn.w.definition(), sort_keys=True, default=str)
	token = None
	if changed and turn.capabilities:
		token = frappe.generate_hash(length=16)
		frappe.cache.set_value('qa-copilot-caps:' + token, {'user': frappe.session.user, 'specs': turn.capabilities}, expires_in_sec=CACHE_TTL)
	definition = turn.w.definition()
	return {
		'reply': _plain(plan.get('reply'), 600),
		'changes': turn.changes if changed else [],
		'notes': notes,
		'suggestions': [_plain(s, 100) for s in plan.get('suggestions') or [] if isinstance(s, str)][:3],
		'proposal': {k: definition[k] for k in ('name', 'description', 'triggers', 'steps')} if changed else None,
		'token': token,
		'ai_steps': len(turn.capabilities) if changed else 0,
	}


def _partial_reply(text):
	"""The "reply" string of a JSON answer that is still arriving."""
	m = re.search(r'"reply"\s*:\s*"((?:\\.|[^"\\])*)', text or '')
	if not m:
		return ''
	raw = m[1]
	if raw.endswith('\\'):
		raw = raw[:-1]
	try:
		return json.loads('"' + raw + '"')
	except ValueError:
		return raw.replace('\\n', '\n').replace('\\"', '"')


# ------------------------------------------------------------------ jobs


def _job_key(job):
	return 'qa-copilot-job:' + job


def _queue():
	try:
		from fac_model_bridge.runtime import ai_queue

		return ai_queue()
	except ImportError:
		return 'ai' if 'ai' in (frappe.conf.get('workers') or {}) else 'long'


def _has_worker(queue):
	try:
		from frappe.utils.background_jobs import generate_qname, get_workers

		name = generate_qname(queue)
		return any(name in w.queue_names() for w in get_workers())
	except Exception:
		return False


@frappe.whitelist(methods=['POST'])
def start(prompt, workflow, history=None, selected=None, answered=0):
	"""Start one sidebar turn. Returns a job id to poll."""
	builder._guard()
	if not str(prompt or '').strip():
		frappe.throw(_('Type a request first.'))
	job = frappe.generate_hash(length=16)
	frappe.cache.set_value(_job_key(job), {'user': frappe.session.user, 'state': 'queued', 'stage': _('Waiting for the AI…')}, expires_in_sec=CACHE_TTL)
	kwargs = {'job': job, 'prompt': prompt, 'workflow': workflow, 'history': history, 'selected': selected,
		'answered': answered, 'lang': frappe.local.lang}
	queue = _queue()
	if frappe.flags.in_test or not _has_worker(queue):
		# no worker on this bench (a laptop): answer in this request instead of waiting forever
		execute(**kwargs)
	else:
		frappe.enqueue('quest_automations.copilot.execute', queue=queue, timeout=600, job_id='qa-copilot-' + job, **kwargs)
	return {'job': job}


def execute(job, prompt, workflow, history=None, selected=None, answered=0, lang=None):
	if lang:
		frappe.local.lang = lang
	key = _job_key(job)
	state = frappe.cache.get_value(key) or {}
	owner = state.get('user') or frappe.session.user

	def progress(**values):
		frappe.cache.set_value(key, {**(frappe.cache.get_value(key) or {}), 'user': owner, 'state': 'working', **values}, expires_in_sec=CACHE_TTL)

	try:
		result = run_turn(prompt, workflow, history, selected, answered, progress)
		frappe.cache.set_value(key, {'user': owner, 'state': 'done', 'result': result}, expires_in_sec=CACHE_TTL)
	except (DefinitionError, frappe.ValidationError, frappe.PermissionError) as error:
		frappe.db.rollback()
		message = str(error) or _('Something went wrong. Try again.')
		frappe.clear_last_message()
		frappe.cache.set_value(key, {'user': owner, 'state': 'failed', 'error': _plain(message, 400)}, expires_in_sec=CACHE_TTL)
	except Exception:
		frappe.db.rollback()
		frappe.log_error('Quest Automations AI sidebar')
		frappe.cache.set_value(key, {'user': owner, 'state': 'failed', 'error': _('Something went wrong. Try again.')}, expires_in_sec=CACHE_TTL)


@frappe.whitelist(methods=['GET'])
def poll(job):
	builder._guard()
	state = frappe.cache.get_value(_job_key(str(job or '')))
	if not state or state.get('user') != frappe.session.user:
		return {'state': 'failed', 'error': _('This answer expired. Ask again.')}
	return {k: v for k, v in state.items() if k != 'user'}


@frappe.whitelist(methods=['POST'])
@builder._friendly
def prepare(token=None):
	"""Create the AI steps a proposal needs, right before the editor applies it."""
	builder._guard()
	if not token:
		return {'ok': True}
	saved = frappe.cache.get_value('qa-copilot-caps:' + str(token))
	if not saved or saved.get('user') != frappe.session.user:
		raise DefinitionError(_('This proposal expired. Ask again.'))
	for spec in saved['specs']:
		builder._ensure_capability(spec)
	return {'ok': True}


@frappe.whitelist(methods=['GET'], allow_guest=False)
def translations(lang=None):
	from frappe.translate import get_translations_from_apps

	builder._guard()
	return get_translations_from_apps(lang or frappe.local.lang or 'en', apps=['quest_automations'])
