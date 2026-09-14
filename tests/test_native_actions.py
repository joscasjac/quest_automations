import types
import unittest
from unittest.mock import Mock, patch
from quest_automations import native_actions as actions
from quest_automations.core.definition import DefinitionError
from quest_automations.core.javascript import execute_code

class NativeActionTests(unittest.TestCase):
    def meta(self, child=False):
        return Mock(istable=child, issingle=False, get_valid_columns=Mock(return_value=['name','email','parent','parenttype','api_secret']), get_field=Mock(return_value=None))

    def test_search_uses_permission_filtered_list(self):
        with patch.object(actions.frappe,'get_meta',return_value=self.meta(),create=True), patch.object(actions.frappe,'get_list',return_value=[{'name':'L1'}],create=True) as search:
            self.assertEqual(actions.find_documents({'doctype':'CRM Lead','fields':['name']}),[{'name':'L1'}])
            self.assertNotIn('ignore_permissions',search.call_args.kwargs)
            self.assertEqual(search.call_args.kwargs['limit_page_length'],100)

    def test_search_rejects_permission_override_and_passwords(self):
        with self.assertRaises(DefinitionError):actions.find_documents({'doctype':'User','ignore_permissions':True})
        meta=self.meta();meta.get_field.return_value=Mock(fieldtype='Password')
        with patch.object(actions.frappe,'get_meta',return_value=meta,create=True), self.assertRaises(DefinitionError):actions.find_documents({'doctype':'User','fields':['api_secret']})

    def test_search_fails_closed_at_limit(self):
        with patch.object(actions.frappe,'get_meta',return_value=self.meta(),create=True), patch.object(actions.frappe,'get_list',return_value=[{'name':'L1'}],create=True), self.assertRaises(DefinitionError):actions.find_documents({'doctype':'CRM Lead','limit':1})

    def test_child_search_checks_each_parent(self):
        child=self.meta(True);parent=Mock(fields=[Mock(fieldtype='Table',options='Contact Email')])
        client=types.ModuleType('frappe.client');client.get_list=Mock(return_value=[{'parent':'visible','parenttype':'Contact','email':'a@example.com'},{'parent':'hidden','parenttype':'Contact','email':'b@example.com'}])
        with patch.dict('sys.modules',{'frappe.client':client}), patch.object(actions.frappe,'get_meta',side_effect=[child,parent],create=True), patch.object(actions.frappe,'get_doc',side_effect=lambda dt,name:Mock(has_permission=Mock(return_value=name=='visible')),create=True):
            self.assertEqual(actions.find_documents({'doctype':'Contact Email','parent':'Contact','fields':['email']}),[{'email':'a@example.com'}])

    def test_batch_failure_rolls_back_prior_inserts(self):
        db=Mock();first=Mock();first.insert.return_value.name='N1';second=Mock();second.insert.side_effect=PermissionError('Denied')
        with patch.object(actions.frappe,'get_meta',return_value=self.meta(),create=True), patch.object(actions.frappe,'db',db,create=True), patch.object(actions.frappe,'get_doc',side_effect=[first,second],create=True), self.assertRaises(PermissionError):
            actions.create_documents({'documents':[{'doctype':'FCRM Note','title':'A'},{'doctype':'CRM Task','title':'B'}]})
        first.insert.assert_called_once_with();db.rollback.assert_called_once_with(save_point=db.savepoint.call_args.args[0])

    def test_protected_creation_fields_rejected(self):
        for key in ['docstatus','flags','ignore_permissions','name']:
            with self.assertRaises(DefinitionError):actions.create_documents({'documents':[{'doctype':'CRM Task',key:1}]})

    def test_native_bridge_needs_no_http(self):
        with patch.object(actions,'find_documents',return_value=[{'name':'L1'}]), patch.object(actions,'create_documents',return_value=['N1']):
            result=execute_code('const leads=await api.findDocuments({doctype:"CRM Lead"}); return await api.createDocuments([{doctype:"FCRM Note",title:leads[0].name}]);',{'trigger':{},'steps':{}})
        self.assertEqual(result,['N1'])

    def test_preview_never_calls_native_operations(self):
        with patch.object(actions,'find_documents') as search, self.assertRaises(DefinitionError):execute_code('return await api.findDocuments({doctype:"User"});',{'trigger':{},'steps':{},'_preview':True})
        search.assert_not_called()
