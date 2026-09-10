"""Adapter contract tests; real Frappe installation smoke test is also required."""
import sys,types,unittest,json
from unittest.mock import Mock,patch
frappe=types.ModuleType('frappe');frappe.whitelist=lambda **kw:lambda fn:fn
frappe.as_json=lambda v:json.dumps(v,default=str)
frappe.session=types.SimpleNamespace(user='manager@example.com')
frappe.PermissionError=PermissionError
frappe.get_roles=lambda:['System Manager']
frappe.throw=lambda msg,*args:(_ for _ in ()).throw(PermissionError(msg))
sys.modules['frappe']=frappe
from quest_automations import native,api
from quest_automations.core.graph import execute_native

class NativeTests(unittest.TestCase):
    def test_guest_cannot_use_editor_api(self):
        with patch.object(frappe.session,'user','Guest'),self.assertRaises(PermissionError):api.require_access()
    def test_reader_cannot_use_editor_api(self):
        with patch.object(frappe,'get_roles',return_value=['Accounts User']),self.assertRaises(PermissionError):api.require_access()
    def test_get_document_checks_read_permission(self):
        doc=Mock();doc.as_dict.return_value={'name':'T-1'}
        with patch.object(frappe,'get_doc',return_value=doc,create=True):
            self.assertEqual(native.erp_request('Task','T-1'),{'name':'T-1'});doc.check_permission.assert_called_once_with('read')
    def test_update_keeps_normal_validation(self):
        doc=Mock()
        with patch.object(frappe,'get_doc',return_value=doc,create=True):
            native.erp_request('Task','T-1',{'subject':'Example'});doc.check_permission.assert_called_once_with('write');doc.save.assert_called_once_with()
    def test_email_uses_current_site_account(self):
        with patch.object(frappe,'get_list',return_value=[{'email_id':'sender@example.com'}],create=True),patch.object(frappe,'get_attr',return_value=Mock(return_value={'name':'COMM-1'}),create=True) as resolve:
            output=execute_native({'kind':'send_email','sender':'sender@example.com','to':'recipient@example.com','subject':'Test','body':'Body'},{'trigger':{},'steps':{}},'run','step')
            self.assertEqual(output,{'name':'COMM-1'});resolve.assert_called_once_with('frappe.core.doctype.communication.email.make')
    def test_js_runs_in_packaged_layout(self):
        from quest_automations.core.javascript import execute_code
        self.assertEqual(execute_code('return {value: input.value * 2};',{'trigger':{'value':3},'steps':{}}),{'value':6})

if __name__=='__main__':unittest.main()
