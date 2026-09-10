"""ERPNext calls use the current Frappe user, with no separate credentials."""
import frappe
import json
def json_value(value):return json.loads(frappe.as_json(value))
from .core.definition import DefinitionError

def erp_request(doctype,name=None,fields=None,action=None):
    if action:
        from frappe.model.workflow import apply_workflow
        doc=frappe.get_doc(doctype,name);doc.check_permission('read');doc.check_permission('write')
        return json_value(apply_workflow(doc.as_dict(),action).as_dict())
    if fields is None:
        doc=frappe.get_doc(doctype,name) if name else frappe.get_single(doctype)
        doc.check_permission('read');return json_value(doc.as_dict())
    if name is not None:
        doc=frappe.get_doc(doctype,name);doc.check_permission('write');doc.update(fields);doc.save()
    else:doc=frappe.get_doc({'doctype':doctype,**fields}).insert()
    return json_value(doc.as_dict())

def erp_method(method,body):
    if method not in {'frappe.desk.form.assign_to.add','frappe.core.doctype.communication.email.make'}:raise DefinitionError('Unsupported ERPNext method')
    return json_value(frappe.get_attr(method)(**body))

def erp_email_accounts():
    return frappe.get_list('Email Account',filters={'enable_outgoing':1},fields=['name','email_id','default_outgoing'],limit_page_length=10000,order_by='name')
def erp_files():return frappe.get_list('File',filters={'is_folder':0},fields=['name','file_name','file_url'],limit_page_length=1000,order_by='modified desc')
def erp_doctypes():
    return frappe.get_list('DocType',fields=['name','module','istable','issingle','custom'],limit_page_length=20000,order_by='name')
def erp_metadata(doctype):
    if not frappe.has_permission('DocType','read',doc=doctype):frappe.throw('Not permitted to read this document type',frappe.PermissionError)
    meta=frappe.get_meta(doctype)
    fields=[{key:getattr(f,key,None) for key in ('fieldname','label','fieldtype','options','reqd','read_only','hidden')} for f in meta.fields if f.fieldtype!='Password']
    return {'name':doctype,'fields':fields,'is_submittable':meta.is_submittable}
