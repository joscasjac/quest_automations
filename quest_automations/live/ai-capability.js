/* Site Client Script: edit this UI live; migrations only seed missing scripts. */
frappe.ui.form.on('Quest AI Capability', {
  refresh(frm) {
    const live = Number(frm.doc.published_revision || 0);
    frm.set_intro(live ? __('Workflows use published revision {0}. Save keeps your edits as a draft; Publish makes them live. Test draft runs AI only and records a debug result.', [live]) : __('Define the inputs and result, test with sample data, then publish. Testing does not run CRM or email actions.'));
    frm.add_custom_button(__('Test draft'), async () => {
      const values = Object.fromEntries(['title','instructions','input_schema','output_schema'].map(key=>[key,frm.doc[key]]));
      const dialog = new frappe.ui.Dialog({title:__('Test this capability'),fields:[
        {fieldname:'input',label:__('Test input (JSON)'),fieldtype:'Code',options:'JSON',reqd:1,default:frm.doc.sample_input || '{}'}
      ],primary_action_label:__('Run AI test'),async primary_action(input) {
        dialog.disable_primary_action();
        try {
          const {message:run}=await frappe.call({method:'quest_automations.ai_capabilities.test',type:'POST',args:{name:frm.is_new()?'':frm.doc.name,values:JSON.stringify(values),input_value:input.input,request_id:crypto.randomUUID()}});
          dialog.hide();
          frappe.msgprint({title:__('AI test queued'),message:`<p>A debug run was queued. It uses your connected ChatGPT allowance and runs no follow-on actions.</p><p><a href="/desk/quest-ai-run/${encodeURIComponent(run.run)}">Open test result</a></p>`});
        } finally { dialog.enable_primary_action(); }
      }});
      dialog.show();
    });
    if (!frm.is_new()) frm.add_custom_button(__('Publish capability'), () => frappe.confirm(__('Publish these instructions and formats for future workflow runs?'), async () => {
      if(frm.is_dirty())await frm.save();
      const {message:result}=await frappe.call({method:'quest_automations.ai_capabilities.publish',type:'POST',args:{name:frm.doc.name,expected_modified:frm.doc.modified}});
      await frm.reload_doc();
      frappe.show_alert({message:__('Published revision {0}',[result.revision]),indicator:'green'});
    }));
    if(!frm.is_new())frm.add_custom_button(__('Run history'),()=>frappe.set_route('List','Quest AI Run',{capability:frm.doc.name}));
  }
});
