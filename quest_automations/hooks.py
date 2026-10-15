app_name = "quest_automations"
app_title = "Quest Automations"
app_publisher = "Quest Media Hub"
app_description = "Visual API-first ERPNext automation workflows"
app_email = "joseph@questmediahub.com"
app_license = "mit"
required_apps = ["erpnext"]
has_permission = {"Quest AI Capability": "quest_automations.chatgpt_connection.has_permission", "Quest AI Run": "quest_automations.chatgpt_connection.has_permission", "Quest Followup Playbook": "quest_automations.chatgpt_connection.has_permission", "Quest ChatGPT Connection": "quest_automations.chatgpt_connection.has_permission", "Quest Meeting Followup": "quest_automations.chatgpt_connection.has_permission"}
permission_query_conditions = {"Quest AI Capability": "quest_automations.chatgpt_connection.permission_query", "Quest AI Run": "quest_automations.chatgpt_connection.permission_query", "Quest Meeting Followup": "quest_automations.chatgpt_connection.permission_query"}
assistant_tools = ["quest_automations.assistant_tools.automations.QuestAutomations"]
website_route_rules = [{"from_route":"/automations/<path:app_path>","to_route":"automations"}]
scheduler_events = {"cron":{"* * * * *":["quest_automations.jobs.wake"]}}
doc_events = {"*":{event:"quest_automations.jobs.document_event" for event in ("after_insert","on_update","on_submit","on_cancel","on_update_after_submit")}}
add_to_apps_screen = [{"name":"quest_automations","logo":"/assets/quest_automations/icon.svg","title":"Automations","route":"/automations","has_permission":"quest_automations.api.has_access"}]

after_migrate = ["quest_automations.live_setup.seed", "quest_automations.ai_setup.seed"]
