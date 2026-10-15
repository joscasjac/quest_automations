frappe.ui.form.on('Quest ChatGPT Connection', {
  refresh(frm) {
    frm.disable_save();
    if (frappe.session.user !== 'joseph@questmediahub.com') return;
    frm.add_custom_button(__('Continue with ChatGPT'), async () => {
      const { message: options } = await frappe.call({ method: 'quest_automations.chatgpt_connection.sign_in_options', type: 'POST' });
      await frm.reload_doc();
      const escape = frappe.utils.escape_html;
      frappe.msgprint({ title: __('Connect your ChatGPT plan'), message: `<p>Complete the Quest Automations sign-in helper on your computer, then import its protected registration file here. AI requests run on your Frappe Cloud site after sign-in; your computer can be turned off.</p><p>Host ID: <code>${escape(options.host_id)}</code></p><p>Registration ID: <code>${escape(options.client_id || '(first sign-in)')}</code></p><p>This connects ChatGPT plan usage. It does not provide access to your ChatGPT conversations. Manage access and limits in <a href="https://chatgpt.com/settings/usage" target="_blank" rel="noopener">ChatGPT Settings</a>.</p>` });
    });
    frm.add_custom_button(__('Import protected registration'), () => {
      const picker = document.createElement('input');
      picker.type = 'file'; picker.accept = '.json,application/json';
      picker.onchange = async () => {
        const file = picker.files?.[0];
        if (!file || file.size > 50000) return frappe.msgprint(__('Choose the protected registration JSON file (under 50 KB).'));
        let registration = await file.text();
        try {
          await frappe.call({ method: 'quest_automations.chatgpt_connection.import_registration', args: { registration }, type: 'POST', freeze: true });
          await frm.reload_doc();
          frappe.msgprint(__('ChatGPT connected. Credentials are encrypted in ERPNext. Remove the temporary registration file from your computer after verification.'));
        } finally { registration = ''; picker.value = ''; }
      };
      picker.click();
    });
    if (frm.doc.status === 'Connected') {
      frm.add_custom_button(__('Choose AI model'), async () => {
        const { message: result } = await frappe.call({ method: 'quest_automations.chatgpt_connection.available_models', type: 'POST' });
        frappe.prompt([{ fieldname: 'model', label: __('Model'), fieldtype: 'Select', options: result.models.map(m => ({ label: m.display_name, value: m.slug })), default: result.selected, reqd: 1 }], async ({ model }) => {
          await frappe.call({ method: 'quest_automations.chatgpt_connection.select_model', args: { model }, type: 'POST' });
          await frm.reload_doc();
        }, __('Choose AI model'));
      });
      frm.add_custom_button(__('Prepare waiting follow-ups'), async () => {
        const { message } = await frappe.call({ method: 'quest_automations.meeting_followups.retry_pending', type: 'POST' });
        frappe.msgprint(__('{0} follow-ups queued for drafting.', [message.queued]));
      });
      frm.add_custom_button(__('Disconnect ChatGPT'), () => frappe.confirm(__('Disconnect this ChatGPT session?'), async () => {
        const { message } = await frappe.call({ method: 'quest_automations.chatgpt_connection.disconnect', type: 'POST' });
        await frm.reload_doc();
        if (!message.revocation_confirmed) frappe.msgprint(__('Remote revocation was not confirmed. Disconnect the app in ChatGPT Settings too.'));
      }));
    }
  }
});
