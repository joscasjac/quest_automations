frappe.ui.form.on('Quest AI Run', {
  refresh(frm) {
    frm.disable_save();
    const status=frm.doc.status;
    frm.set_intro(status==='Succeeded' ? __('The result below passed the declared output format. Test runs do not execute CRM or email actions.') : status==='Failed' ? __('This run stopped. Read the notice and inspect the saved input and definition before starting a new test.') : __('This run is queued or processing. Refresh shortly to see the result.'));
    frm.add_custom_button(__('Refresh result'),()=>frm.reload_doc());
    if(frm.doc.capability)frm.add_custom_button(__('Open capability'),()=>frappe.set_route('Form','Quest AI Capability',frm.doc.capability));
  }
});
