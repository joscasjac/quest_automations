import os
import time
from .definition import DefinitionError, evaluate_condition, resolve, validate
from .transport import erp_request, request


def execute_action(kind, config, run_id, step_id):
    if kind == 'outgoing_webhook':
        from .http_action import execute
        return execute(config,run_id,step_id)
    return erp_request(config['doctype'], config.get('name'), config.get('fields'), config.get('action'))


def preview(definition, payload):
    definition = validate(definition)
    if definition.get('schemaVersion') == 2:
        from .graph import preview_graph
        return preview_graph(definition, payload)
    context = {'trigger': payload, 'steps': {}}
    result = []
    for step in definition['steps']:
        try:
            config = resolve(step['config'], context)
            if step['kind'] == 'condition':
                passed = evaluate_condition(config)
                result.append({'id': step['id'], 'status': 'passed' if passed else 'filtered_out'})
                context['steps'][step['id']] = {'passed': passed}
                if not passed:
                    break
            else:
                if step['kind'] == 'outgoing_webhook':
                    config['headers'] = {k: '[redacted]' for k in config.get('headers', {})}
                result.append({'id': step['id'], 'status': 'would_execute', 'kind': step['kind'], 'config': config})
        except DefinitionError as error:
            result.append({'id': step['id'], 'status': 'unresolved', 'message': str(error)})
    return {'dryRun': True, 'steps': result, 'note': 'No HTTP requests or ERPNext writes were made. Outputs from external actions are unavailable in preview.'}


def tick(store, executor=execute_action):
    store.enqueue_schedules()
    run = store.claim()
    if not run:
        return False
    if run['definition'].get('schemaVersion') == 2:
        from .graph import process
        process(run,store)
        return True
    for step in run['definition']['steps'][run['cursor']:]:
        started = time.time()
        try:
            config = resolve(step['config'], {'trigger': run['input'], 'steps': run['outputs']})
            if step['kind'] == 'delay':
                run['outputs'][step['id']] = {'seconds': config['seconds']}
                run['cursor'] += 1
                run['logs'].append({'id': step['id'], 'status': 'waiting', 'at': started})
                store.checkpoint(run, 'waiting', config['seconds'])
                return True
            if step['kind'] == 'condition':
                output = {'passed': evaluate_condition(config)}
                if not output['passed']:
                    run['logs'].append({'id': step['id'], 'status': 'filtered_out', 'at': started})
                    run['outputs'][step['id']] = output
                    store.checkpoint(run, 'filtered_out')
                    return True
            else:
                output = executor(step['kind'], config, run['id'], step['id'])
            run['outputs'][step['id']] = output
            run['cursor'] += 1
            run['logs'].append({'id': step['id'], 'status': 'succeeded', 'at': started, 'durationMs': round((time.time()-started)*1000)})
            store.checkpoint(run, 'running')
        except Exception as error:
            # Avoid logging credentials or full remote error responses.
            message = str(error) if isinstance(error, DefinitionError) else 'External request failed or had an uncertain result. Inspect the destination before retrying.'
            run['logs'].append({'id': step['id'], 'status': 'failed', 'at': started, 'error': message})
            store.checkpoint(run, 'failed' if isinstance(error, DefinitionError) else 'needs_attention', error=message)
            return True
    store.checkpoint(run, 'succeeded')
    return True
