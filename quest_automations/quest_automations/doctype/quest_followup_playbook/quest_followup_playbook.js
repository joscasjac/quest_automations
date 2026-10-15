frappe.ui.form.on('Quest Followup Playbook', {
  refresh(frm) {
    frm.set_intro(__('Saving updates future drafts immediately. Existing drafts keep their original policy. Use Test instructions to try unsaved changes without sending email.'));
    frm.add_custom_button(__('Test instructions'), () => {
      const dialog = new frappe.ui.Dialog({title: __('Try a cancellation scenario'), fields: [
        {fieldname:'scenario', fieldtype:'Long Text', label:__('Scenario'), reqd:1,
          default:'Alex is interested in a website redesign but cancelled because of an urgent deadline. They asked for our booking link to choose a time next week. No scope or pricing has been agreed.'}
      ], primary_action_label:__('Generate test draft'), async primary_action(values) {
        dialog.disable_primary_action();
        try {
          const policy = Object.fromEntries(['instructions','booking_url','signature','review_intro'].map(key => [key, frm.doc[key]]));
          const {message: result} = await frappe.call({method:'quest_automations.followup_playbook.preview', args:{values:JSON.stringify(policy),scenario:values.scenario},type:'POST',timeout:180000});
          dialog.hide();
          const e = frappe.utils.escape_html;
          frappe.msgprint({title:__('Test result — nothing sent'), message:`<p><b>${e(result.draft.recommendation)}</b></p><p>${e(result.draft.rationale)}</p><hr><p><b>${e(result.draft.subject)}</b></p><div style="white-space:pre-wrap">${e(result.draft.body)}</div><hr><small>Policy ${e(result.revision)} · ${e(result.model)}</small>`,wide:true});
        } finally { dialog.enable_primary_action(); }
      }});
      dialog.show();
    });
  }
});
