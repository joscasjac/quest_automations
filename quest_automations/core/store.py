import hashlib
import hmac
import json
import os
import secrets
import sqlite3
import threading
import time
import uuid
from .definition import ACTIONS, DefinitionError, validate, trigger_list, select_trigger


def encode(value):
    return json.dumps(value, allow_nan=False, separators=(',', ':'))


class Store:
    def __init__(self, path):
        self.lock = threading.RLock()
        self.db = sqlite3.connect(path, check_same_thread=False)
        if path != ':memory:':
            os.chmod(path, 0o600)
        self.db.row_factory = sqlite3.Row
        self.db.executescript('''
        PRAGMA journal_mode=WAL;
        CREATE TABLE IF NOT EXISTS workflows (
          id TEXT PRIMARY KEY, draft TEXT NOT NULL, revision INTEGER NOT NULL,
          published TEXT, version INTEGER NOT NULL DEFAULT 0,
          status TEXT NOT NULL DEFAULT 'draft', hook_secret TEXT NOT NULL, updated REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS runs (
          id TEXT PRIMARY KEY, workflow_id TEXT NOT NULL, version INTEGER NOT NULL,
          definition TEXT NOT NULL, input TEXT NOT NULL, outputs TEXT NOT NULL DEFAULT '{}',
          logs TEXT NOT NULL DEFAULT '[]', cursor INTEGER NOT NULL DEFAULT 0,
          status TEXT NOT NULL, due REAL NOT NULL, created REAL NOT NULL, error TEXT,
          event_key TEXT, UNIQUE(workflow_id,event_key));
        CREATE TABLE IF NOT EXISTS versions(id TEXT PRIMARY KEY,workflow_id TEXT,number INTEGER,definition TEXT,created REAL);
        CREATE TABLE IF NOT EXISTS schedules(workflow_id TEXT,trigger_id TEXT,due REAL,interval REAL,PRIMARY KEY(workflow_id,trigger_id));
        CREATE INDEX IF NOT EXISTS runs_due ON runs(status,due);
        CREATE INDEX IF NOT EXISTS runs_workflow ON runs(workflow_id,created);
        ''')
        if 'trigger_id' not in {r[1] for r in self.db.execute('PRAGMA table_info(runs)')}:
            self.db.execute('ALTER TABLE runs ADD COLUMN trigger_id TEXT')
        # Never replay an interrupted external write automatically.
        self.db.execute("UPDATE runs SET status='needs_attention',error='Server stopped during execution. Check destination before retrying.' WHERE status='running'")
        self.db.commit()

    def workflow(self, identifier):
        row = self.db.execute('SELECT * FROM workflows WHERE id=?', (identifier,)).fetchone()
        if not row:
            raise KeyError('Workflow not found')
        result = dict(row)
        result.pop('hook_secret')
        result['recentRuns'] = [{'status': r['status']} for r in self.db.execute('SELECT status FROM runs WHERE workflow_id=? ORDER BY created DESC LIMIT 100', (identifier,))]
        result['draft'] = json.loads(result['draft'])
        result['published'] = json.loads(result['published']) if result['published'] else None
        return result

    def list(self):
        with self.lock:
            return [self.workflow(row['id']) for row in self.db.execute('SELECT id FROM workflows ORDER BY updated DESC LIMIT 200')]

    def save(self, draft, identifier=None, revision=None):
        if not isinstance(draft, dict) or not isinstance(draft.get('name'), str):
            raise DefinitionError('Draft must have a name')
        if draft.get('schemaVersion') == 2:
            validate({**draft, "steps": draft["steps"] or [{"kind":"noop","label":"Empty draft"}]})
        elif (type(draft.get('schemaVersion')) is not int or draft['schemaVersion'] != 1
                or not isinstance(draft.get('steps'), list)
                or len(draft['steps']) > 100
                or any(not isinstance(step, dict) or not isinstance(step.get('id'), str)
                       or step.get('kind') not in ACTIONS or not isinstance(step.get('config'), dict)
                       for step in draft['steps'])):
            raise DefinitionError('Draft requires schemaVersion 1, a supported trigger, and steps with id, kind, and config')
        trigger_list(draft)
        encoded = encode(draft)
        if len(encoded) > 250000:
            raise DefinitionError('Draft exceeds 250 KB')
        with self.lock, self.db:
            if identifier:
                row = self.workflow(identifier)
                if type(revision) is not int or revision != row['revision']:
                    raise DefinitionError('Revision conflict: reload this workflow before saving')
                self.db.execute('UPDATE workflows SET draft=?, revision=revision+1, updated=? WHERE id=?', (encoded, time.time(), identifier))
            else:
                identifier = str(uuid.uuid4())
                self.db.execute('INSERT INTO workflows(id,draft,revision,hook_secret,updated) VALUES(?,?,1,?,?)', (identifier, encoded, secrets.token_urlsafe(32), time.time()))
            saved=self.workflow(identifier)
            self.db.execute('INSERT INTO versions VALUES(?,?,?,?,?)',(identifier+':'+str(saved['revision']),identifier,saved['revision'],encoded,time.time()))
            return saved

    def publish(self, identifier, revision):
        with self.lock, self.db:
            row = self.workflow(identifier)
            if revision != row['revision']:
                raise DefinitionError('Revision conflict: reload before publishing')
            draft = validate(row['draft'])
            self.db.execute("UPDATE workflows SET published=?,version=version+1,status='active',updated=? WHERE id=?", (encode(draft), time.time(), identifier))
            self.db.execute('DELETE FROM schedules WHERE workflow_id=?',(identifier,))
            for trigger in trigger_list(draft):
                if trigger['kind']=='schedule':
                    interval=trigger['intervalMinutes']*60
                    self.db.execute('INSERT INTO schedules VALUES(?,?,?,?)',(identifier,trigger['id'],time.time()+interval,interval))
            return self.workflow(identifier)

    def pause(self, identifier):
        with self.lock, self.db:
            self.workflow(identifier)
            self.db.execute("UPDATE workflows SET status='paused',updated=? WHERE id=?", (time.time(), identifier))
            return self.workflow(identifier)

    def hook_secret(self, identifier, trigger_id=None):
        with self.lock:
            row = self.db.execute('SELECT hook_secret FROM workflows WHERE id=?', (identifier,)).fetchone()
            if not row:
                raise KeyError('Workflow not found')
            return hmac.new(row[0].encode(), trigger_id.encode(), hashlib.sha256).hexdigest() if trigger_id else row[0]

    def enqueue(self, identifier, payload, event_key, expected_trigger=None, trigger_id=None):
        with self.lock, self.db:
            row = self.workflow(identifier)
            if row['status'] != 'active' or not row['published']:
                raise DefinitionError('Workflow must be published and active')
            trigger = select_trigger(row['published'], expected_trigger, trigger_id, payload if expected_trigger == 'document_event' else None) if expected_trigger or trigger_id else None
            if trigger and trigger.get('condition'):
                from .graph import condition_matches,context_for
                if not condition_matches(trigger['condition'],context_for({'input':payload,'outputs':{},'definition':row['published']})):
                    return {'id':None,'status':'filtered_out'}
            if trigger and trigger['kind']=='record':
                from .graph import condition_matches, FIELDS
                if not all(condition_matches(f,{'trigger':payload}) for f in trigger.get('filters',[])):
                    raise DefinitionError('Record trigger filters do not match')
                if trigger['event'] in ('stage_changed','status_changed'):
                    field='sales_stage' if trigger['event']=='stage_changed' else 'status'
                    if field not in payload.get('previous',{}) or payload.get(field)==payload['previous'][field]:
                        raise DefinitionError('Change trigger requires previous and current values showing a change')
            if trigger and trigger['id'] != 'legacy':
                event_key = trigger['id'] + ':' + event_key
            existing = self.db.execute('SELECT id FROM runs WHERE workflow_id=? AND event_key=?', (identifier, event_key)).fetchone()
            if existing:
                return self.run(existing[0])
            run_id = str(uuid.uuid4())
            now = time.time()
            self.db.execute('INSERT INTO runs(id,workflow_id,version,definition,input,status,due,created,event_key) VALUES(?,?,?,?,?,?,?,?,?)',
                            (run_id, identifier, row['version'], encode(row['published']), encode(payload), 'queued', now, now, event_key))
            self.db.execute('UPDATE runs SET trigger_id=? WHERE id=?', (trigger['id'] if trigger else None, run_id))
            return self.run(run_id)

    def run(self, identifier):
        row = self.db.execute('SELECT * FROM runs WHERE id=?', (identifier,)).fetchone()
        if not row:
            raise KeyError('Run not found')
        result = dict(row)
        for field in ('definition', 'input', 'outputs', 'logs'):
            result[field] = json.loads(result[field])
        return result

    def runs(self, workflow_id):
        with self.lock:
            return [self.run(row[0]) for row in self.db.execute('SELECT id FROM runs WHERE workflow_id=? ORDER BY created DESC LIMIT 100', (workflow_id,))]

    def claim(self):
        with self.lock, self.db:
            row = self.db.execute("SELECT id FROM runs WHERE status IN ('queued','waiting') AND due<=? ORDER BY due LIMIT 1", (time.time(),)).fetchone()
            if not row:
                return None
            self.db.execute("UPDATE runs SET status='running' WHERE id=?", (row[0],))
            return self.run(row[0])

    def checkpoint(self, run, status, delay=0, error=None):
        with self.lock, self.db:
            self.db.execute('UPDATE runs SET outputs=?,logs=?,cursor=?,status=?,due=?,error=? WHERE id=?',
                            (encode(run['outputs']), encode(run['logs']), run['cursor'], status, time.time()+delay, error, run['id']))


    def versions(self, identifier):
        with self.lock:
            rows=self.db.execute('SELECT * FROM versions WHERE workflow_id=? ORDER BY number DESC LIMIT 100',(identifier,)).fetchall()
            if not rows:
                row=self.workflow(identifier)
                return [{'id':identifier+':'+str(row['revision']),'number':row['revision'],'definition':row['draft'],'created':row['updated']}]
            return [{**dict(row),'definition':json.loads(row['definition'])} for row in rows]

    def record_preview(self, identifier, payload, result):
        with self.lock,self.db:
            row=self.workflow(identifier);run_id=str(uuid.uuid4());now=time.time()
            logs=result.get('steps',[])
            self.db.execute('INSERT INTO runs(id,workflow_id,version,definition,input,outputs,logs,status,due,created,error,trigger_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
                (run_id,identifier,row['revision'],encode(row['draft']),encode(payload),encode(result.get('outputs',{})),encode(logs),result.get('status','succeeded'),now,now,result.get('error'),'Preview'))
            return self.run(run_id)

    def enqueue_schedules(self):
        with self.lock,self.db:
            rows=self.db.execute("SELECT s.* FROM schedules s JOIN workflows w ON w.id=s.workflow_id WHERE w.status='active' AND s.due<=? LIMIT 20",(time.time(),)).fetchall()
            for row in rows:
                self.enqueue(row['workflow_id'],{'scheduled_at':row['due']},'schedule:'+str(row['due']),'schedule',row['trigger_id'])
                self.db.execute('UPDATE schedules SET due=? WHERE workflow_id=? AND trigger_id=?',(time.time()+row['interval'],row['workflow_id'],row['trigger_id']))

    def listen(self,identifier,trigger_id):
        from .definition import select_trigger
        with self.lock,self.db:
            select_trigger(self.workflow(identifier)['draft'],'incoming_webhook',trigger_id)
            self.db.execute('CREATE TABLE IF NOT EXISTS webhook_samples(workflow_id TEXT,trigger_id TEXT,expires REAL,payload TEXT,received REAL,PRIMARY KEY(workflow_id,trigger_id))')
            self.db.execute('INSERT OR REPLACE INTO webhook_samples VALUES(?,?,?,NULL,NULL)',(identifier,trigger_id,time.time()+300))
        return self.sample(identifier,trigger_id)

    def sample(self,identifier,trigger_id):
        with self.lock:
            self.db.execute('CREATE TABLE IF NOT EXISTS webhook_samples(workflow_id TEXT,trigger_id TEXT,expires REAL,payload TEXT,received REAL,PRIMARY KEY(workflow_id,trigger_id))')
            row=self.db.execute('SELECT * FROM webhook_samples WHERE workflow_id=? AND trigger_id=?',(identifier,trigger_id)).fetchone()
            if not row:return {'listening':False,'sample':None}
            return {'listening':row['expires']>time.time() and row['payload'] is None,'sample':json.loads(row['payload']) if row['payload'] else None,'received':row['received']}

    def capture(self,identifier,trigger_id,payload):
        with self.lock,self.db:
            state=self.sample(identifier,trigger_id)
            if not state['listening']:raise DefinitionError('Start listening for a test event in the workflow editor first')
            self.db.execute('UPDATE webhook_samples SET payload=?,received=?,expires=0 WHERE workflow_id=? AND trigger_id=?',(encode(payload),time.time(),identifier,trigger_id))
        return {'captured':True}
