/* Live Client Script: Quest Follow-up Review. Saved in the site, no asset build. */
frappe.ui.form.on('Quest Meeting Followup', {
  async refresh(frm) {
    if (frm.is_new() || frappe.session.user !== 'joseph@questmediahub.com') return;
    const slot = frm.fields_dict.custom_review_panel;
    if (!slot) return; // Standard form remains a functional fallback.
    frm.clear_custom_buttons();
    const e = value => frappe.utils.escape_html(String(value || ''));
    const d = frm.doc;
    const editable = d.status === 'Needs review';
    const labels = {reschedule:__('Invite them to reschedule'),clarify:__('Ask a clarifying question'),commercial_proposal:__('Propose the next project step'),no_follow_up:__('No email recommended')};
    const state = {
      'Needs review':[__('Ready for your review'),__('Check the context and adjust the email. You choose when it sends.')],
      'Queued':[__('Approved and queued'),__('You approved this message. It has been queued for delivery; this does not confirm inbox delivery.')],
      'No follow-up':[__('No email recommended'),__('Read the recommendation below. You can close this follow-up without contacting them.')],
      'Dismissed':[__('Closed without sending'),__('This follow-up was dismissed.')],
      'Draft failed':[__('Draft needs attention'),__('Check the notice below, then try preparing the draft again.')],
      'Waiting for ChatGPT':[__('Preparing the draft'),__('Refresh this record shortly to see the recommendation.')]
    }[d.status] || [__(d.status),''];
    const hidden = ['status','event','booking_uid','cancellation_reason','recipient','recommendation','rationale','subject','body','evidence','model','task','last_error','notification_queued','sent_communication','approved_by','approved_at','playbook_snapshot'];
    hidden.filter(key => frm.fields_dict[key]).forEach(key => frm.set_df_property(key,'hidden',1));
    slot.$wrapper.html(`
      <style>
      .q-review{--q-line:var(--border-color,#dfe2e5);--q-muted:var(--text-muted,#56616d);color:var(--text-color,#20252b);font-size:14px;padding:8px 0 24px}
      .q-review *{box-sizing:border-box}.q-review h2{font-size:24px;line-height:1.25;margin:0 0 8px;font-weight:650;letter-spacing:-.02em}.q-review h3{font-size:16px;font-weight:650;margin:0 0 16px}.q-review p{line-height:1.6;margin:0 0 12px}.q-review .q-muted{color:var(--q-muted)}
      .q-review .q-top{padding-bottom:24px;border-bottom:1px solid var(--q-line)}.q-review .q-state{display:inline-block;font-size:12px;font-weight:600;padding:5px 9px;border-radius:6px;background:var(--subtle-fg,#edf0f2);margin-bottom:14px}
      .q-review .q-layout{display:grid;grid-template-columns:minmax(0,1.8fr) minmax(250px,1fr);gap:32px;margin-top:28px}.q-review .q-context{border-left:1px solid var(--q-line);padding-left:28px}.q-review .q-field{margin-bottom:20px}.q-review label{display:block;font-size:13px;font-weight:600;margin-bottom:8px}.q-review input,.q-review textarea{width:100%;border:1px solid var(--q-line);background:var(--control-bg,#f8f9fa);color:inherit;border-radius:6px;padding:11px 12px;font:inherit}.q-review textarea{min-height:340px;line-height:1.65;resize:vertical}.q-review input:focus,.q-review textarea:focus{outline:2px solid var(--primary,#234db5);outline-offset:2px}.q-review input:disabled,.q-review textarea:disabled{opacity:1;background:var(--fg-color,#fff)}
      .q-review .q-envelope{display:grid;grid-template-columns:48px minmax(0,1fr);gap:9px 12px;padding-bottom:22px;margin-bottom:22px;border-bottom:1px solid var(--q-line);overflow-wrap:anywhere}.q-review .q-envelope dt{font-weight:500;color:var(--q-muted)}.q-review .q-envelope dd{margin:0}.q-review .q-actions{display:flex;flex-wrap:wrap;gap:10px;align-items:center;padding-top:6px}.q-review .btn{min-height:40px}.q-review .q-caption{font-size:12px;line-height:1.5;margin-top:12px;color:var(--q-muted)}.q-review .q-context section{margin-bottom:28px}.q-review .q-context blockquote{font-size:14px;line-height:1.6;padding:0;margin:0;white-space:pre-wrap;border:0}.q-review details{margin-top:22px;padding-top:18px;border-top:1px solid var(--q-line)}.q-review summary{cursor:pointer;font-weight:600;min-height:32px}.q-review .q-evidence{white-space:pre-wrap;font-size:13px;line-height:1.7;margin-top:12px;overflow-wrap:anywhere}.q-review .q-notice{padding:14px;background:var(--subtle-fg,#edf0f2);border-radius:6px;margin:16px 0}.q-review a{text-decoration:underline;text-underline-offset:3px}.q-review .q-debug{font-size:12px;line-height:1.8;overflow-wrap:anywhere}.q-review button:focus-visible,.q-review summary:focus-visible,.q-review a:focus-visible{outline:2px solid var(--primary,#234db5);outline-offset:3px}
      @media(max-width:800px){.q-review .q-layout{grid-template-columns:1fr;gap:28px}.q-review .q-context{border-left:0;border-top:1px solid var(--q-line);padding:24px 0 0}.q-review h2{font-size:22px}.q-review textarea{min-height:360px}.q-review .q-actions{display:grid;grid-template-columns:1fr 1fr;align-items:stretch}.q-review .q-actions .btn{min-height:44px;white-space:normal}.q-review .q-actions .btn:first-child{grid-column:1/-1}}
      </style>
      <div class="q-review">
        <header class="q-top"><span class="q-state">${e(__(d.status))}</span><h2>${e(state[0])}</h2><p class="q-muted">${e(state[1])}</p></header>
        ${d.last_error ? `<div class="q-notice" role="status">${e(d.last_error)}</div>`:''}
        <div class="q-layout"><main>
          <h3>${__('Email to your contact')}</h3>
          <dl class="q-envelope"><dt>${__('From')}</dt><dd>${d.sent_communication ? __('See the outgoing email record') : 'joseph@questmediahub.com'}</dd><dt>${__('To')}</dt><dd>${e(d.recipient)}</dd></dl>
          <div class="q-field"><label for="q-review-subject">${__('Subject')}</label><input id="q-review-subject" maxlength="140" value="${e(d.subject)}" ${editable?'':'disabled'}></div>
          <div class="q-field"><label for="q-review-body">${__('Message')}</label><textarea id="q-review-body" maxlength="12000" ${editable?'':'disabled'}>${e(d.body)}</textarea></div>
          <div class="q-actions">
          ${editable?`<button type="button" class="btn btn-primary" data-action="review">${e(__('Review & send'))}</button><button type="button" class="btn btn-default" data-action="save">${__('Save draft')}</button>`:''}
          ${['Draft failed','Waiting for ChatGPT'].includes(d.status)?`<button type="button" class="btn btn-primary" data-action="retry">${__('Prepare draft again')}</button><button type="button" class="btn btn-default" data-action="refresh">${__('Refresh')}</button>`:''}
          ${!['Queued','Dismissed'].includes(d.status)?`<button type="button" class="btn btn-default" data-action="dismiss">${__('Close without sending')}</button>`:''}
          </div><p class="q-caption" role="status" data-save-state>${e(editable?__('Edits stay here until you save. Review & send saves first and shows a final confirmation.'):__('This message cannot be edited in its current state.'))}</p>
        </main><aside class="q-context" aria-label="${__('Meeting context')}">
          <section><h3>${__('Recommended next step')}</h3><p><strong>${e(labels[d.recommendation] || __('Waiting for a recommendation'))}</strong></p><p>${e(d.rationale || __('The recommendation will appear after the draft is ready.'))}</p></section>
          <section><h3>${__('Why they cancelled')}</h3><blockquote>${e(d.cancellation_reason || __('No cancellation reason was provided.'))}</blockquote></section>
          <p><a href="/desk/event/${encodeURIComponent(d.event)}">${__('Open meeting')}</a>${d.task?` · <a href="/desk/crm-task/${encodeURIComponent(d.task)}">${__('Review task')}</a>`:''}</p>
          <details><summary>${__('Evidence behind the draft')}</summary><div class="q-evidence">${e(d.evidence || __('No supporting records were provided.'))}</div></details>
          <details><summary>${e(__('Details & troubleshooting'))}</summary><div class="q-debug">${__('Model: {0}',[e(d.model || __('Not yet selected'))])}<br>${__('Booking: {0}',[e(d.booking_uid)])}<br>${__('Review notification: {0}',[d.notification_queued?__('Queued'):__('Not yet queued')])}${d.approved_at?`<br>${__('Approved: {0}',[e(d.approved_at)])}`:''}${d.sent_communication?`<br><a href="/desk/communication/${encodeURIComponent(d.sent_communication)}">${__('Open outgoing email')}</a>`:''}<p>${__('Notifications to you come from {0}.',['notifications@noreply.questmediahub.com'])}</p><a href="/desk/quest-followup-playbook">${__('Edit drafting playbook')}</a> · <a href="/desk/client-script/Quest%20Follow-up%20Review">${__('Edit this interface')}</a></div></details>
        </aside></div>
      </div>`);
    const root = slot.$wrapper;
    root.find('.q-actions').appendTo(root.find('.q-top'));
    root.find('[data-save-state]').appendTo(root.find('.q-top'));
    if (d.status === 'No follow-up' && !d.subject && !d.body) {
      root.find('main').html(`<h3>${__('No email to send')}</h3><p>${__('The AI recommends closing this follow-up. Read the reasoning and supporting records alongside, then choose Close without sending.')}</p>`);
    }
    const debug = root.find('.q-debug');
    if (d.playbook_snapshot) {
      try { debug.prepend($('<p>').text(__('Drafting policy: {0}',[JSON.parse(d.playbook_snapshot).revision]))); } catch (_) { debug.prepend($('<p>').text(__('Drafting policy details unavailable'))); }
    } else { debug.prepend($('<p>').text(__('Prepared before playbook version tracking'))); }
    root.find('#q-review-subject').on('input', function(){frm.set_value('subject',this.value); root.find('[data-save-state]').text(__('Unsaved changes'));});
    root.find('#q-review-body').on('input', function(){frm.set_value('body',this.value); root.find('[data-save-state]').text(__('Unsaved changes'));});
    const call = (method,args={}) => frappe.call({method:'quest_automations.meeting_followups.'+method,args:{name:frm.doc.name,...args},type:'POST'});
    const save = async () => {if(frm.is_dirty()) await frm.save();};
    let busy=false;
    root.find('[data-action]').on('click',async function(){
      if(busy)return; busy=true; root.find('[data-action]').prop('disabled',true);
      try {
        const action=this.dataset.action;
        if(action==='save'){await save();frappe.show_alert({message:__('Draft saved'),indicator:'green'});}
        if(action==='refresh')await frm.reload_doc();
        if(action==='retry'){await call('retry_pending');frappe.show_alert(__('Draft preparation queued. Refresh shortly.'));}
        if(action==='dismiss')frappe.confirm(__('Close this follow-up without sending an email?'),async()=>{await call('dismiss');await frm.reload_doc();});
        if(action==='review'){
          await save();
          const {message:draft}=await call('review');
          if(!draft.can_send)return frappe.msgprint(__('This draft is no longer available for sending. Refresh to see its current state.'));
          const confirm=new frappe.ui.Dialog({title:__('Approve this email'),size:'large',fields:[{fieldname:'preview',fieldtype:'HTML'}],primary_action_label:__('Approve & send'),async primary_action(){
            confirm.disable_primary_action();
            try{await call('approve_and_send',{expected_hash:draft.hash});confirm.hide();await frm.reload_doc();frappe.show_alert({message:__('Approved email queued for delivery.'),indicator:'green'});}catch(error){confirm.enable_primary_action();throw error;}
          }});
          confirm.fields_dict.preview.$wrapper.html(`<p><b>${__('From:')}</b> ${e(draft.sender)}<br><b>${__('To:')}</b> ${e(draft.recipient)}</p><hr><p><b>${e(draft.subject)}</b></p><div style="white-space:pre-wrap;line-height:1.7;max-height:50vh;overflow:auto">${e(draft.body)}</div><hr><p>${e(__('Approve & send queues this exact email to the recipient above.'))}</p>`);
          confirm.show();
        }
      }finally{busy=false;root.find('[data-action]').prop('disabled',false);}
    });
  }
});
