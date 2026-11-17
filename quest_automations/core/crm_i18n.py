"""Spanish messages for CRM actions. Other languages fall back to English."""

ACTION_LABELS_ES = {
    'crm_send_whatsapp': 'CRM: Enviar WhatsApp',
    'crm_send_whatsapp_template': 'CRM: Enviar plantilla de WhatsApp',
    'crm_send_sms': 'CRM: Enviar SMS',
    'crm_send_messenger': 'CRM: Enviar mensaje por Messenger',
    'crm_send_instagram': 'CRM: Enviar mensaje por Instagram',
    'crm_send_email': 'CRM: Enviar correo electrónico',
    'crm_add_note': 'CRM: Agregar nota',
    'crm_add_task': 'CRM: Agregar tarea',
    'crm_add_comment': 'CRM: Agregar comentario',
    'crm_log_call': 'CRM: Registrar llamada',
    'crm_get_conversation': 'CRM: Obtener conversación',
    'crm_describe_operations': 'CRM: Describir operaciones',
}

MESSAGES_ES = {
    'CRM actions target a CRM Lead or CRM Deal': 'Las acciones de CRM deben apuntar a un CRM Lead o un CRM Deal',
    'Unsupported CRM action': 'Acción de CRM no compatible',
    'Install CRM Conversations on this site to use CRM actions': 'Instala CRM Conversations en este sitio para usar las acciones de CRM',
    '{action}: {field} is required and must be text or a reference': '{action}: {field} es obligatorio y debe ser texto o una referencia',
}


def language():
    try:
        import frappe
        lang = getattr(getattr(frappe, 'local', None), 'lang', None)
    except ImportError:
        lang = None
    return 'es' if isinstance(lang, str) and lang.lower().startswith('es') else 'en'


def action_label(kind, lang=None):
    if (lang or language()) == 'es' and kind in ACTION_LABELS_ES:
        return ACTION_LABELS_ES[kind]
    return 'CRM: ' + kind.removeprefix('crm_').replace('_', ' ')


def message(text, lang=None, **values):
    if (lang or language()) == 'es':
        text = MESSAGES_ES.get(text, text)
    return text.format(**values)
