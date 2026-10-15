frappe.ui.form.on('Quest Meeting Followup', {
  refresh(frm) {
    if (frappe.session.user !== 'joseph@questmediahub.com' || frm.is_new()) return;
    if (frm.doc.status === 'Needs review') {
      frm.add_custom_button(__('Review and approve sending'), async () => {
        if (frm.is_dirty()) await frm.save();
        const { message: draft } = await frappe.call({ method: 'quest_automations.meeting_followups.review', args: { name: frm.doc.name }, type: 'POST' });
        if (!draft.can_send) return frappe.msgprint(__('This draft is not available for sending.'));
        const escape = frappe.utils.escape_html;
        frappe.confirm(`<p><b>To:</b> ${escape(draft.recipient)}</p><p><b>From:</b> notifications@noreply.questmediahub.com</p><p><b>Subject:</b> ${escape(draft.subject)}</p><div style="white-space:pre-wrap;max-height:360px;overflow:auto">${escape(draft.body)}</div><p>Approve sending this exact email?</p>`, async () => {
          await frappe.call({ method: 'quest_automations.meeting_followups.approve_and_send', args: { name: frm.doc.name, expected_hash: draft.hash }, type: 'POST', freeze: true });
          await frm.reload_doc();
          frappe.show_alert(__('Approved email queued for delivery.'));
        });
      }).addClass('btn-primary');
    }
    if (['Waiting for ChatGPT', 'Draft failed'].includes(frm.doc.status)) {
      frm.add_custom_button(__('Prepare AI draft'), async () => {
        await frappe.call({ method: 'quest_automations.meeting_followups.retry_pending', args: { name: frm.doc.name }, type: 'POST' });
        frappe.show_alert(__('Draft preparation queued.'));
      });
    }
    if (!['Queued', 'Dismissed'].includes(frm.doc.status)) {
      frm.add_custom_button(__('Dismiss follow-up'), () => frappe.confirm(__('Close this follow-up without sending an email?'), async () => {
        await frappe.call({ method: 'quest_automations.meeting_followups.dismiss', args: { name: frm.doc.name }, type: 'POST' });
        await frm.reload_doc();
      }));
    }
  }
});
