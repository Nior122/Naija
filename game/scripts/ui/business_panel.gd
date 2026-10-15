class_name BusinessPanel
extends VBoxContainer

signal business_action_requested(action: String, payload: Dictionary)

const CATALOG_PATH := "res://data/businesses/catalog.json"
const TEXT_DARK := Color("#27352b")
const TEXT_MUTED := Color("#657466")
const GREEN := Color("#39734a")
const WARN_COLOR := Color("#8a4c36")
const LIGHT_GREEN := Color("#e6eee2")
const READ_ONLY_ACTIONS: Array[String] = ["discover", "view"]
const LOCATIONS: Array[String] = ["market", "town", "home", "community_hall"]
const EXPENSE_KINDS: Array[String] = [
	"supplies", "rent", "utilities", "transport", "maintenance", "other"
]

var _catalog: Dictionary = {}
var _character: Dictionary = {}
var _world_date: Dictionary = {}
var _nearby_players: Array = []
var _owned_businesses: Array = []
var _discovered_businesses: Array = []
var _known_profiles: Dictionary = {}
var _inspected_business: Dictionary = {}
var _selected_business_id := ""
var _active_tab := "owned"
var _online := false
var _busy := false
var _notice := ""
var _notice_is_error := false
var _preserved_notice := ""
var _pending_reads: Array[Dictionary] = []
var _form: Dictionary = {
	"create_template": "template:provision-store",
	"create_name": "Naija Ventures",
	"create_desc": "Neighbourhood retail and service enterprise.",
	"create_location": "market",
	"create_capital": "25000",
	"buy_qty": "1",
	"restock_qty": "10",
	"capital_amount": "25000",
	"withdraw_amount": "10000",
	"expense_kind": "utilities",
	"expense_amount": "5000",
	"expense_desc": "Utility and premises upkeep",
	"transfer_amount": "10000",
	"salary_amount": "15000",
	"branch_location": "town",
	"branch_name": "Town Quarter Branch",
	"branch_premises": "shop",
}


func _init() -> void:
	_load_catalog()


func configure(
	character: Dictionary,
	business_profiles: Array,
	is_online: bool,
	world_date: Dictionary,
	nearby_players: Array = []
) -> void:
	_character = character.duplicate(true)
	_world_date = world_date.duplicate(true)
	_nearby_players = nearby_players.duplicate(true)
	_online = is_online
	_ingest_owned_businesses(business_profiles)
	_render()


func request_initial_data() -> void:
	if _online:
		_pending_reads.clear()
		if not _selected_business_id.is_empty():
			var vp := {"business_id": _selected_business_id}
			_pending_reads.append({"action": "view", "payload": vp})
		_emit_action("discover", _discover_payload())


func apply_server_response(message: Dictionary) -> void:
	_busy = false
	var response_type := str(message.get("type", ""))
	var action := str(message.get("action", ""))
	if response_type == "business.error":
		_pending_reads.clear()
		_preserved_notice = ""
		var code := str(message.get("code", "business_error"))
		var err_text := str(message.get("message", "The server rejected this business request."))
		_notice = "%s (%s)" % [err_text, code]
		_notice_is_error = true
		_render()
		return
	if response_type != "business.result":
		_render()
		return
	var data: Variant = message.get("data", {})
	if not data is Dictionary:
		_notice = "The server response did not include business data."
		_notice_is_error = true
		_render()
		return
	_apply_result_data(action, data, str(message.get("message", "Business records updated.")))
	if not _pending_reads.is_empty() and _online:
		var next_read: Dictionary = _pending_reads.pop_front()
		var next_act := str(next_read.get("action", "discover"))
		_emit_action(next_act, next_read.get("payload", {}) as Dictionary, true)
		return
	if not _preserved_notice.is_empty():
		_notice = _preserved_notice
		_preserved_notice = ""
		_notice_is_error = false
	_render()


func show_transport_error(message: String) -> void:
	_busy = false
	_pending_reads.clear()
	_preserved_notice = ""
	_notice = message
	_notice_is_error = true
	_render()


func update_records(business_profiles: Array) -> void:
	_ingest_owned_businesses(business_profiles)
	if not _busy and not _has_focused_input():
		_render()


func update_world_context(
	character: Dictionary, world_date: Dictionary, nearby_players: Array = []
) -> void:
	var changed := (
		int(_character.get("age", 0)) != int(character.get("age", 0))
		or str(_character.get("life_status", "")) != str(character.get("life_status", ""))
		or int(_character.get("money", 0)) != int(character.get("money", 0))
		or _date_key(_world_date) != _date_key(world_date)
		or _nearby_players.size() != nearby_players.size()
	)
	_character = character.duplicate(true)
	_world_date = world_date.duplicate(true)
	_nearby_players = nearby_players.duplicate(true)
	if changed and not _busy and not _has_focused_input():
		_render()


func _load_catalog() -> void:
	if FileAccess.file_exists(CATALOG_PATH):
		var parsed: Variant = JSON.parse_string(FileAccess.get_file_as_string(CATALOG_PATH))
		if parsed is Dictionary:
			_catalog = parsed


func _ingest_owned_businesses(business_profiles: Array) -> void:
	_owned_businesses = business_profiles.duplicate(true)
	for entry in _owned_businesses:
		if entry is Dictionary:
			var bid := _biz_id(entry)
			if not bid.is_empty():
				_known_profiles[bid] = entry.duplicate(true)
				if bid == _selected_business_id:
					_inspected_business = entry.duplicate(true)
	if _selected_business_id.is_empty() and not _owned_businesses.is_empty():
		var first: Variant = _owned_businesses[0]
		if first is Dictionary:
			_selected_business_id = _biz_id(first)
			_inspected_business = first.duplicate(true)


func _apply_result_data(action: String, data: Dictionary, server_message: String) -> void:
	if not READ_ONLY_ACTIONS.has(action):
		_preserved_notice = server_message
		_notice = server_message
		_notice_is_error = false
	elif _preserved_notice.is_empty():
		_notice = server_message
		_notice_is_error = false

	match action:
		"discover":
			var list_val: Variant = data.get("businesses", [])
			if list_val is Array:
				_discovered_businesses = list_val.duplicate(true)
		"view":
			var profile: Variant = data.get("business_profile", {})
			if profile is Dictionary and not profile.is_empty():
				_store_profile(profile)
		_:
			var profile: Variant = data.get("business_profile", {})
			if profile is Dictionary and not profile.is_empty():
				_store_profile(profile)
				if action == "create":
					_active_tab = "inspect"
			var biz_rec: Variant = data.get("business", {})
			if biz_rec is Dictionary and not str(biz_rec.get("business_id", "")).is_empty():
				_selected_business_id = str(biz_rec.get("business_id", ""))
			_queue_post_mutation_refresh()


func _store_profile(profile: Dictionary) -> void:
	var bid := _biz_id(profile)
	if bid.is_empty():
		return
	_selected_business_id = bid
	_inspected_business = profile.duplicate(true)
	_known_profiles[bid] = profile.duplicate(true)
	for i in range(_owned_businesses.size()):
		var entry: Variant = _owned_businesses[i]
		if entry is Dictionary and _biz_id(entry) == bid:
			_owned_businesses[i] = profile.duplicate(true)
			return
	if _caller_role(profile) in ["owner", "co_owner"]:
		_owned_businesses.push_front(profile.duplicate(true))


func _queue_post_mutation_refresh() -> void:
	_pending_reads = [{"action": "discover", "payload": _discover_payload()}]
	if not _selected_business_id.is_empty():
		_pending_reads.append({"action": "view", "payload": {"business_id": _selected_business_id}})


func _discover_payload() -> Dictionary:
	var loc := str(_form.get("discover_location", "")).strip_edges()
	return {} if loc.is_empty() else {"location_id": loc}


func _emit_action(action: String, payload: Dictionary, keep_preserved: bool = false) -> void:
	if not _online or _busy:
		return
	if not keep_preserved:
		_preserved_notice = ""
	_busy = true
	if _preserved_notice.is_empty():
		_notice = "Waiting for the shared business service…"
		_notice_is_error = false
	_render()
	business_action_requested.emit(action, payload.duplicate(true))


func _render() -> void:
	for child in get_children():
		child.queue_free()
	if not _online:
		_text(self, "Businesses and storefronts require the connected shared world.", 14, TEXT_DARK)
		_text(self, "Business accounts, sales, payroll, and transfers are server-validated.")
		return
	_add_header_section()
	_add_navigation_bar()
	add_child(HSeparator.new())
	match _active_tab:
		"discover":
			_render_discover_tab()
		"create":
			_render_create_tab()
		"inspect":
			_render_inspect_tab()
		_:
			_render_owned_tab()


func _add_header_section() -> void:
	_text(self, "Shared-world businesses, storefronts, and business economy accounts", 15, GREEN)
	_text(
		self,
		"Each business holds its own Naira account for capital, sales, payroll, and transfers."
	)
	var age := int(_character.get("age", 15))
	var bal := _format_number(int(_character.get("money", 0)))
	var date_txt := _format_date(_world_date)
	_text(self, "Personal cash: ₦%s  ·  Age: %d  ·  Date: %s" % [bal, age, date_txt], 12, TEXT_DARK)
	if not _notice.is_empty():
		var color := WARN_COLOR if _notice_is_error else (TEXT_MUTED if _busy else GREEN)
		_text(self, _notice, 12, color)


func _add_navigation_bar() -> void:
	var nav := _row(self)
	_add_tab_button(nav, "My Businesses (%d)" % _owned_businesses.size(), "owned")
	_add_tab_button(nav, "Directory & Shop (%d)" % _discovered_businesses.size(), "discover")
	_add_tab_button(nav, "Launch Business", "create")
	if not _inspected_business.is_empty():
		var b_name := str(_biz_rec(_inspected_business).get("name", "Business")).left(18)
		_add_tab_button(nav, "Inspect: %s" % b_name, "inspect")
	_btn(nav, "Refresh", request_initial_data)


func _add_tab_button(parent: Node, label_text: String, tab_id: String) -> void:
	var title := ("• " + label_text) if _active_tab == tab_id else label_text
	_btn(
		parent,
		title,
		func():
			_active_tab = tab_id
			_render()
	)


func _render_owned_tab() -> void:
	_text(self, "Businesses owned by your character", 14, GREEN)
	if _owned_businesses.is_empty():
		_text(
			self, "You do not own any businesses yet. Use 'Launch Business' or 'Directory & Shop'."
		)
		return
	for item in _owned_businesses:
		if not item is Dictionary:
			continue
		var prof: Dictionary = item
		var brec := _biz_rec(prof)
		var bid := _biz_id(prof)
		var card := _create_card()
		var status := _format_status(str(brec.get("status", "active")))
		var loc := _format_loc(_biz_location(prof))
		_text(card, "%s (%s)  ·  %s" % [str(brec.get("name", bid)), status, loc], 14, TEXT_DARK)
		_text(card, _biz_financial_line(prof), 12, GREEN)
		_btn(card, "Manage & view business account", func(): _inspect_business(bid))


func _render_discover_tab() -> void:
	_text(self, "Active business directory & buyer storefront", 14, GREEN)
	var filter_row := _row(self)
	_location_option(filter_row, "discover_location", true)
	_btn(filter_row, "Filter directory", func(): _emit_action("discover", _discover_payload()))
	_btn(
		filter_row,
		"Show all",
		func():
			_form["discover_location"] = ""
			_emit_action("discover", {})
	)

	if _discovered_businesses.is_empty():
		_text(self, "No active businesses found for this location filter.")
		return
	for item in _discovered_businesses:
		if not item is Dictionary:
			continue
		var prof: Dictionary = item
		var brec := _biz_rec(prof)
		var bid := _biz_id(prof)
		var card := _create_card()
		var loc := _format_loc(_biz_location(prof))
		_text(card, "%s  ·  %s" % [str(brec.get("name", bid)), loc], 14, TEXT_DARK)
		var cat := _format_cat(str(brec.get("category_id", "")))
		var rep := int(brec.get("reputation_score", brec.get("reputation", 50)))
		var pcount := int(brec.get("product_count", 0))
		_text(card, "%s  ·  Reputation: %d/100  ·  Products/services: %d" % [cat, rep, pcount])
		_btn(card, "Open storefront & details", func(): _inspect_business(bid))


func _render_create_tab() -> void:
	_text(self, "Launch a new business", 14, GREEN)
	var rules: Dictionary = _catalog.get("rules", {})
	var min_age := int(rules.get("minimum_owner_age_years", 18))
	var max_biz := int(rules.get("maximum_businesses_per_character", 3))
	_text(
		self,
		(
			"Requires age %d+ and <= %d active businesses; capital funds the business account."
			% [min_age, max_biz]
		)
	)

	var card := _create_card()
	var tmpl_ids: Array[String] = []
	var tmpl_labels: Array[String] = []
	for t_val in _catalog.get("templates", []):
		if t_val is Dictionary:
			var tid := str(t_val.get("id", ""))
			var fee := _format_number(int(t_val.get("setup_cost_ngn", 50000)))
			tmpl_ids.append(tid)
			tmpl_labels.append("%s (setup ₦%s)" % [str(t_val.get("label", tid)), fee])
	var r1 := _row(card)
	_text(r1, "Template:", 12, TEXT_DARK)
	var tmpl_opt := _option(r1, "create_template", tmpl_ids, tmpl_labels)
	tmpl_opt.item_selected.connect(func(_idx: int): _render())

	var selected_tmpl := _template_by_id(str(_form.get("create_template", "")))
	if not selected_tmpl.is_empty():
		var fee := _format_number(int(selected_tmpl.get("setup_cost_ngn", 0)))
		var desc := str(selected_tmpl.get("description", ""))
		_text(card, "%s  ·  Setup fee: ₦%s" % [desc, fee])

	var r2 := _row(card)
	_input(r2, "create_name", "Business name (2-60 chars)")
	_input(r2, "create_desc", "Business description")
	var r3 := _row(card)
	_location_option(r3, "create_location")
	_input(r3, "create_capital", "Initial capital ₦", 140.0)
	_btn(r3, "Launch business", _submit_create_business)


func _render_inspect_tab() -> void:
	if _inspected_business.is_empty():
		_text(self, "Select a business from My Businesses or Directory & Shop to inspect.")
		return
	var prof := _inspected_business
	var brec := _biz_rec(prof)
	var bid := _biz_id(prof)
	var status := str(brec.get("status", "active"))
	var role := _caller_role(prof)

	var header := _create_card()
	var btitle := "%s (%s)  ·  %s" % [str(brec.get("name", bid)), bid, _format_status(status)]
	_text(header, btitle, 15, GREEN)
	var cat := _format_cat(str(brec.get("category_id", "")))
	var loc := _format_loc(_biz_location(prof))
	var rep := int(brec.get("reputation_score", brec.get("reputation", 50)))
	var role_txt := "Customer / Viewer" if role.is_empty() else _format_status(role)
	var meta := "%s  ·  %s  ·  Reputation: %d/100  ·  Role: %s" % [cat, loc, rep, role_txt]
	_text(header, meta, 12, TEXT_DARK)
	_text(header, _biz_financial_line(prof), 12, GREEN)

	_add_storefront_section(prof, bid, status == "active", role in ["owner", "co_owner"])
	if status == "active" and role in ["owner", "co_owner", "manager"]:
		_add_operations_section(prof, bid)
		_add_treasury_section(prof, bid, role)
		_add_staff_section(prof, bid, role)
		if role in ["owner", "co_owner"]:
			_add_expansion_and_closure_section(prof, bid, role)
	_add_ledger_history_section(prof)


func _add_storefront_section(
	prof: Dictionary, bid: String, is_active: bool, is_owner: bool
) -> void:
	var store := _create_card()
	_text(store, "Buyer storefront (paid from personal cash to business account)", 13, GREEN)
	_text(store, "Sales are initiated by purchasing customers (buy_product / buy_service).")
	var qty_row := _row(store)
	_text(qty_row, "Product quantity:", 11, TEXT_DARK)
	_option(qty_row, "buy_qty", ["1", "2", "3", "5", "10"], ["×1", "×2", "×3", "×5", "×10"])

	var products: Variant = prof.get("products", [])
	if products is Array and not products.is_empty():
		for p_val in products:
			if (
				not p_val is Dictionary
				or not bool(p_val.get("available", p_val.get("active", true)))
			):
				continue
			var prod: Dictionary = p_val
			var rec_id := str(prod.get("product_record_id", prod.get("product_id", "")))
			var def_id := str(prod.get("product_definition_id", ""))
			var is_service := def_id.begins_with("biz-service:")
			var price := _format_number(int(prod.get("price_ngn", 0)))
			var stock := _product_stock(prof, def_id)
			var prow := _row(store)
			var pname := str(prod.get("display_name", prod.get("name", def_id)))
			if is_service:
				_text(prow, "%s (Service)  ·  ₦%s" % [pname, price], 12, TEXT_DARK)
				if is_active and not is_owner:
					_btn(prow, "Buy service", func(): _submit_buy_service(bid, rec_id))
			else:
				_text(prow, "%s  ·  ₦%s  ·  Stock: %d" % [pname, price, stock], 12, TEXT_DARK)
				if is_active and not is_owner and stock > 0:
					_btn(prow, "Buy product", func(): _submit_buy_product(bid, rec_id))
	else:
		_text(store, "No products or services listed on this storefront yet.")


func _add_operations_section(prof: Dictionary, bid: String) -> void:
	var ops := _create_card()
	_text(ops, "Catalogue, restocking & production", 13, GREEN)

	var cat_ids: Array[String] = []
	var cat_labels: Array[String] = []
	for p_def in _catalog.get("business_products", []):
		if p_def is Dictionary:
			var did := str(p_def.get("id", ""))
			var bp := _format_number(int(p_def.get("base_price_ngn", 0)))
			cat_ids.append(did)
			cat_labels.append("%s (₦%s)" % [str(p_def.get("label", did)), bp])
	if not cat_ids.is_empty():
		var add_row := _row(ops)
		_option(add_row, "add_product_def", cat_ids, cat_labels)
		_input(add_row, "add_product_price", "Custom ₦ (opt)", 115.0)
		_btn(add_row, "Add product/service", func(): _submit_add_product(bid))

	var phys_ids: Array[String] = []
	var phys_labels: Array[String] = []
	for prod in prof.get("products", []):
		if prod is Dictionary and bool(prod.get("available", true)):
			var def_id := str(prod.get("product_definition_id", ""))
			if not def_id.begins_with("biz-service:"):
				var cost := _format_number(_product_unit_cost(prof, def_id))
				var st := _product_stock(prof, def_id)
				var pname := str(prod.get("display_name", prod.get("name", def_id)))
				phys_ids.append(def_id)
				phys_labels.append("%s (₦%s/u, stock %d)" % [pname, cost, st])
	if not phys_ids.is_empty():
		var restock_row := _row(ops)
		_option(restock_row, "restock_product_id", phys_ids, phys_labels)
		_input(restock_row, "restock_qty", "Qty (1-500)", 95.0)
		_btn(restock_row, "Restock (business funds)", func(): _submit_restock(prof, bid))

	var rec_ids: Array[String] = []
	var rec_labels: Array[String] = []
	for rec in _catalog.get("production_recipes", []):
		if rec is Dictionary and bool(rec.get("active", true)):
			var rid := str(rec.get("id", ""))
			var ocost := _format_number(int(rec.get("operating_cost_ngn", 0)))
			var out_q := int(rec.get("output_quantity", 1))
			rec_ids.append(rid)
			rec_labels.append("%s (₦%s → ×%d)" % [str(rec.get("label", rid)), ocost, out_q])
	if not rec_ids.is_empty():
		var prod_row := _row(ops)
		_option(prod_row, "produce_recipe_id", rec_ids, rec_labels)
		_btn(prod_row, "Run production", func(): _submit_produce(bid))


func _add_treasury_section(prof: Dictionary, bid: String, role: String) -> void:
	var treas := _create_card()
	_text(treas, "Business economy account & inter-business transfers", 13, GREEN)

	if role in ["owner", "co_owner"]:
		var cap_row := _row(treas)
		_input(cap_row, "capital_amount", "Contribute ₦ from personal cash")
		var cap_fn := func(): _submit_amount_action("contribute_capital", bid, "capital_amount")
		_btn(cap_row, "Contribute capital", cap_fn)

		var w_row := _row(treas)
		var max_w := _format_number(_biz_balance(prof))
		_input(w_row, "withdraw_amount", "Withdraw ₦ to personal cash (max ₦%s)" % max_w)
		var w_fn := func(): _submit_amount_action("withdraw", bid, "withdraw_amount")
		_btn(w_row, "Withdraw funds", w_fn)

	var exp_row := _row(treas)
	var exp_labels: Array[String] = []
	for ek in EXPENSE_KINDS:
		exp_labels.append(_format_status(ek))
	_option(exp_row, "expense_kind", EXPENSE_KINDS, exp_labels)
	_input(exp_row, "expense_amount", "Amount ₦", 100.0)
	_input(exp_row, "expense_desc", "Expense description")
	_btn(exp_row, "Pay expense", func(): _submit_expense(bid))

	if role in ["owner", "co_owner"]:
		var target_ids: Array[String] = []
		var target_labels: Array[String] = []
		for other in _owned_businesses:
			if other is Dictionary and str(_biz_rec(other).get("status", "active")) == "active":
				var obid := _biz_id(other)
				if not obid.is_empty() and obid != bid:
					target_ids.append(obid)
					target_labels.append("%s (%s)" % [str(_biz_rec(other).get("name", obid)), obid])
		if target_ids.is_empty():
			_text(
				treas,
				"Inter-business transfer (transfer_funds): requires a second active business."
			)
		else:
			var xfer_row := _row(treas)
			_option(xfer_row, "transfer_to_business", target_ids, target_labels)
			_input(xfer_row, "transfer_amount", "Amount ₦", 110.0)
			_btn(xfer_row, "Transfer between businesses", func(): _submit_transfer_funds(bid))


func _add_staff_section(prof: Dictionary, bid: String, role: String) -> void:
	var staff := _create_card()
	_text(staff, "Owners, employees & payroll (pay_salary)", 13, GREEN)
	for o_val in _biz_owners(prof):
		if not o_val is Dictionary or not bool(o_val.get("active", true)):
			continue
		var o_rec: Dictionary = o_val
		var cid := str(o_rec.get("character_id", ""))
		var orole := str(o_rec.get("role", "employee"))
		var pct := int(o_rec.get("share_percent", 0))
		var srow := _row(staff)
		_text(srow, "%s  ·  Role: %s (%d%%)" % [cid, _format_status(orole), pct], 11, TEXT_DARK)
		if orole == "employee":
			_input(srow, "salary_amount", "Salary ₦", 95.0)
			_btn(srow, "Pay salary", func(): _submit_pay_salary(bid, cid))
			if role in ["owner", "co_owner"]:
				var fire_payload := {"business_id": bid, "employee_character_id": cid}
				_btn(srow, "Fire", func(): _emit_action("fire_employee", fire_payload))

	var hire_row := _row(staff)
	var hire_input := _input(hire_row, "hire_target", "Adult player character_id to hire")
	_btn(hire_row, "Hire employee", func(): _submit_hire(bid))
	_add_nearby_player_shortcuts(staff, "hire_target", hire_input)


func _add_expansion_and_closure_section(prof: Dictionary, bid: String, role: String) -> void:
	var exp_box := _create_card()
	_text(exp_box, "Branches, ownership transfer & closure", 13, GREEN)
	var brow := _row(exp_box)
	_location_option(brow, "branch_location")
	var prem_ids: Array[String] = []
	var prem_labels: Array[String] = []
	for p_val in _catalog.get("premises_types", []):
		var pid := str(p_val.get("id", "")) if p_val is Dictionary else str(p_val)
		if not pid.is_empty():
			prem_ids.append(pid)
			prem_labels.append(_format_status(pid))
	_option(brow, "branch_premises", prem_ids, prem_labels)
	_input(brow, "branch_name", "New branch name")
	_btn(brow, "Open branch", func(): _submit_add_branch(bid))

	var trow := _row(exp_box)
	var t_input := _input(trow, "owner_transfer_target", "Recipient character_id")
	_btn(trow, "Transfer ownership", func(): _submit_transfer_ownership(bid))
	_add_nearby_player_shortcuts(exp_box, "owner_transfer_target", t_input)

	if role == "owner":
		var bal := _biz_balance(prof)
		if bal > 0:
			var warn := "Closure blocked: Account holds ₦%s (must be ₦0)." % _format_number(bal)
			_text(exp_box, warn, 11, WARN_COLOR)
		else:
			var close_p := {"business_id": bid, "reason": "Closed by owner."}
			_btn(exp_box, "Close business (₦0 balance)", func(): _emit_action("close", close_p))


func _add_ledger_history_section(prof: Dictionary) -> void:
	var tx_list: Variant = prof.get("recent_transactions", [])
	if tx_list is Array and not tx_list.is_empty():
		var tx_box := _create_card()
		_text(tx_box, "Recent business account transactions", 13, GREEN)
		for tx_val in tx_list.slice(0, mini(6, tx_list.size())):
			if tx_val is Dictionary:
				var amt := int(tx_val.get("amount_ngn", 0))
				var before_b := int(tx_val.get("balance_before_ngn", 0))
				var after_b := int(tx_val.get("balance_after_ngn", 0))
				var sign_str := "+" if after_b >= before_b else "-"
				var dt := _format_date(tx_val.get("world_date", {}))
				var ttype := _format_status(str(tx_val.get("kind", "entry")))
				var amt_txt := "%s₦%s" % [sign_str, _format_number(absi(amt))]
				var desc := str(tx_val.get("description", ""))
				_text(tx_box, "%s · %s · %s · %s" % [dt, ttype, amt_txt, desc])

	var sales: Variant = prof.get("recent_sales", [])
	if sales is Array and not sales.is_empty():
		var s_box := _create_card()
		_text(s_box, "Recent customer sales", 13, GREEN)
		for s_val in sales.slice(0, mini(5, sales.size())):
			if s_val is Dictionary:
				var dt := _format_date(s_val.get("world_date", {}))
				var pdef := str(s_val.get("product_definition_id", "Item"))
				var qty := int(s_val.get("quantity", 1))
				var tot := _format_number(int(s_val.get("total_ngn", 0)))
				_text(s_box, "%s  ·  %s ×%d  ·  ₦%s" % [dt, pdef, qty, tot])


func _submit_create_business() -> void:
	var bname := str(_form.get("create_name", "")).strip_edges()
	var bdesc := str(_form.get("create_desc", "")).strip_edges()
	var raw_cap := str(_form.get("create_capital", "")).strip_edges()
	if bname.length() < 2 or not raw_cap.is_valid_int() or int(raw_cap) < 0:
		_set_local_error("Provide a business name (2+ chars) and a valid initial capital in Naira.")
		return
	var p: Dictionary = {"name": bname, "description": bdesc, "initial_capital_ngn": int(raw_cap)}
	p["template_id"] = str(_form.get("create_template", "template:provision-store"))
	p["location_id"] = str(_form.get("create_location", "market"))
	_emit_action("create", p)


func _submit_buy_product(bid: String, rec_id: String) -> void:
	var qty := clampi(int(str(_form.get("buy_qty", "1"))), 1, 100)
	_emit_action("buy_product", {"business_id": bid, "product_record_id": rec_id, "quantity": qty})


func _submit_buy_service(bid: String, rec_id: String) -> void:
	_emit_action("buy_service", {"business_id": bid, "product_record_id": rec_id})


func _submit_add_product(bid: String) -> void:
	var def_id := str(_form.get("add_product_def", "")).strip_edges()
	if def_id.is_empty():
		return
	var payload: Dictionary = {"business_id": bid, "product_definition_id": def_id}
	var raw_price := str(_form.get("add_product_price", "")).strip_edges()
	if raw_price.is_valid_int() and int(raw_price) > 0:
		payload["custom_price_ngn"] = int(raw_price)
	_emit_action("add_product", payload)


func _submit_restock(prof: Dictionary, bid: String) -> void:
	var def_id := str(_form.get("restock_product_id", "")).strip_edges()
	var raw_qty := str(_form.get("restock_qty", "")).strip_edges()
	if def_id.is_empty() or not raw_qty.is_valid_int() or int(raw_qty) < 1:
		_set_local_error("Select a physical product and enter a positive restock quantity.")
		return
	var p: Dictionary = {"business_id": bid, "product_definition_id": def_id}
	p["quantity"] = int(raw_qty)
	p["unit_cost_ngn"] = _product_unit_cost(prof, def_id)
	_emit_action("restock", p)


func _submit_produce(bid: String) -> void:
	var rid := str(_form.get("produce_recipe_id", "")).strip_edges()
	if rid.is_empty():
		_set_local_error("Select a production recipe.")
	else:
		_emit_action("produce", {"business_id": bid, "recipe_id": rid})


func _submit_amount_action(action: String, bid: String, key: String) -> void:
	var raw := str(_form.get(key, "")).strip_edges()
	if not raw.is_valid_int() or int(raw) < 1:
		_set_local_error("Enter a positive Naira amount.")
	else:
		_emit_action(action, {"business_id": bid, "amount_ngn": int(raw)})


func _submit_expense(bid: String) -> void:
	var raw := str(_form.get("expense_amount", "")).strip_edges()
	var desc := str(_form.get("expense_desc", "")).strip_edges()
	if not raw.is_valid_int() or int(raw) < 1 or desc.is_empty():
		_set_local_error("Provide a positive expense amount and description.")
		return
	var kind := str(_form.get("expense_kind", "utilities"))
	var p := {"business_id": bid, "kind": kind, "amount_ngn": int(raw), "description": desc}
	_emit_action("record_expense", p)


func _submit_transfer_funds(bid: String) -> void:
	var to_bid := str(_form.get("transfer_to_business", "")).strip_edges()
	var raw := str(_form.get("transfer_amount", "")).strip_edges()
	if to_bid.is_empty() or not raw.is_valid_int() or int(raw) < 1:
		_set_local_error("Select a destination business and enter a positive Naira amount.")
	else:
		var p := {"business_id": bid, "to_business_id": to_bid, "amount_ngn": int(raw)}
		_emit_action("transfer_funds", p)


func _submit_pay_salary(bid: String, emp_id: String) -> void:
	var raw := str(_form.get("salary_amount", "")).strip_edges()
	if not raw.is_valid_int() or int(raw) < 1:
		_set_local_error("Enter a positive salary amount in Naira.")
	else:
		var p := {"business_id": bid, "employee_character_id": emp_id, "amount_ngn": int(raw)}
		_emit_action("pay_salary", p)


func _submit_hire(bid: String) -> void:
	var target := str(_form.get("hire_target", "")).strip_edges()
	if target.is_empty():
		_set_local_error("Enter a valid target character ID.")
	else:
		_emit_action("hire_employee", {"business_id": bid, "employee_character_id": target})


func _submit_transfer_ownership(bid: String) -> void:
	var target := str(_form.get("owner_transfer_target", "")).strip_edges()
	if target.is_empty():
		_set_local_error("Enter a valid recipient character ID.")
	else:
		var p: Dictionary = {"business_id": bid, "to_character_id": target}
		p["new_role"] = "co_owner"
		p["share_percent"] = 25
		_emit_action("transfer_ownership", p)


func _submit_add_branch(bid: String) -> void:
	var bname := str(_form.get("branch_name", "")).strip_edges()
	if bname.length() < 2:
		_set_local_error("Enter a branch name (2+ characters).")
		return
	var loc := str(_form.get("branch_location", "town"))
	var prem := str(_form.get("branch_premises", "shop"))
	var p := {"business_id": bid, "name": bname, "location_id": loc, "premises_type": prem}
	_emit_action("add_branch", p)


func _set_local_error(message_text: String) -> void:
	_notice = message_text
	_notice_is_error = true
	_render()


func _inspect_business(bid: String) -> void:
	if not bid.is_empty():
		_selected_business_id = bid
		if _known_profiles.has(bid):
			_inspected_business = (_known_profiles[bid] as Dictionary).duplicate(true)
		_active_tab = "inspect"
		_emit_action("view", {"business_id": bid})


func _biz_rec(prof: Dictionary) -> Dictionary:
	var nested: Variant = prof.get("business", null)
	return nested if nested is Dictionary else prof


func _biz_id(prof: Dictionary) -> String:
	return str(_biz_rec(prof).get("business_id", prof.get("business_id", "")))


func _biz_location(prof: Dictionary) -> String:
	return str(_biz_rec(prof).get("primary_location_id", _biz_rec(prof).get("location_id", "")))


func _biz_balance(prof: Dictionary) -> int:
	return int(_biz_rec(prof).get("balance_ngn", 0))


func _biz_owners(prof: Dictionary) -> Array:
	var own: Variant = prof.get("owners", prof.get("ownership", []))
	return own if own is Array else []


func _product_stock(prof: Dictionary, def_id: String) -> int:
	for inv in prof.get("inventory", []):
		if inv is Dictionary and str(inv.get("product_definition_id", "")) == def_id:
			return int(inv.get("quantity", 0))
	return 0


func _product_unit_cost(prof: Dictionary, def_id: String) -> int:
	for inv in prof.get("inventory", []):
		if inv is Dictionary and str(inv.get("product_definition_id", "")) == def_id:
			var c := int(inv.get("unit_cost_ngn", 0))
			if c > 0:
				return c
	for p_def in _catalog.get("business_products", []):
		if p_def is Dictionary and str(p_def.get("id", "")) == def_id:
			return int(p_def.get("base_cost_ngn", 0))
	return 0


func _caller_role(prof: Dictionary) -> String:
	var my_id := str(_character.get("character_id", ""))
	if my_id.is_empty():
		return ""
	for o_val in _biz_owners(prof):
		if o_val is Dictionary and bool(o_val.get("active", true)):
			if str(o_val.get("character_id", "")) == my_id:
				return str(o_val.get("role", ""))
	return "owner" if str(_biz_rec(prof).get("owner_character_id", "")) == my_id else ""


func _template_by_id(template_id: String) -> Dictionary:
	for t_val in _catalog.get("templates", []):
		if t_val is Dictionary and str(t_val.get("id", "")) == template_id:
			return t_val
	return {}


func _biz_financial_line(prof: Dictionary) -> String:
	var brec := _biz_rec(prof)
	var bal := _format_number(_biz_balance(prof))
	var cap := _format_number(int(brec.get("total_capital_ngn", 0)))
	var rev := _format_number(int(brec.get("total_revenue_ngn", 0)))
	var exp_amt := _format_number(int(brec.get("total_expenses_ngn", 0)))
	return "Account: ₦%s · Capital: ₦%s · Rev: ₦%s · Exp: ₦%s" % [bal, cap, rev, exp_amt]


func _location_option(parent: Node, key: String, include_all: bool = false) -> OptionButton:
	var ids: Array[String] = [""] if include_all else []
	var labels: Array[String] = ["All locations"] if include_all else []
	for loc_id in LOCATIONS:
		ids.append(loc_id)
		labels.append(_format_loc(loc_id))
	return _option(parent, key, ids, labels)


func _add_nearby_player_shortcuts(parent: Node, key: String, target_input: LineEdit) -> void:
	var my_id := str(_character.get("character_id", ""))
	var row: HBoxContainer = null
	for p_val in _nearby_players:
		if not p_val is Dictionary:
			continue
		var cid := str(p_val.get("characterId", ""))
		var cname := str(p_val.get("characterName", cid))
		if cid.is_empty() or cid == my_id:
			continue
		if row == null:
			row = _row(parent)
			_text(row, "Online players:")
		_btn(
			row,
			"%s (%s)" % [cname, cid.left(12)],
			func():
				_form[key] = cid
				if is_instance_valid(target_input):
					target_input.text = cid
		)


func _has_focused_input() -> bool:
	var vp := get_viewport()
	var focus := vp.gui_get_focus_owner() if vp != null else null
	return focus != null and is_ancestor_of(focus)


func _format_cat(cat_id: String) -> String:
	for entry in _catalog.get("categories", []):
		if entry is Dictionary and str(entry.get("id", "")) == cat_id:
			return str(entry.get("label", cat_id))
	return cat_id.trim_prefix("cat:").replace("-", " ").capitalize()


func _format_loc(loc_id: String) -> String:
	return loc_id.trim_prefix("loc:").replace("_", " ").replace("-", " ").capitalize()


func _row(parent: Node) -> HBoxContainer:
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 6)
	parent.add_child(row)
	return row


func _option(parent: Node, key: String, ids: Array, labels: Array) -> OptionButton:
	var opt := OptionButton.new()
	var current_id := str(_form.get(key, ""))
	for i in range(ids.size()):
		opt.add_item(str(labels[i]), i)
		opt.set_item_metadata(i, str(ids[i]))
		if str(ids[i]) == current_id:
			opt.select(i)
	if opt.item_count > 0 and opt.selected < 0:
		opt.select(0)
		_form[key] = str(opt.get_item_metadata(0))
	opt.item_selected.connect(func(idx: int): _form[key] = str(opt.get_item_metadata(idx)))
	parent.add_child(opt)
	return opt


func _btn(parent: Node, label_text: String, callback: Callable) -> Button:
	var button := Button.new()
	button.text = label_text
	button.disabled = _busy
	button.pressed.connect(callback)
	parent.add_child(button)
	return button


func _input(parent: Node, key: String, placeholder: String, min_w: float = 0.0) -> LineEdit:
	var field := LineEdit.new()
	field.placeholder_text = placeholder
	field.text = str(_form.get(key, ""))
	if min_w > 0.0:
		field.custom_minimum_size = Vector2(min_w, 32.0)
	else:
		field.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	field.text_changed.connect(func(val: String): _form[key] = val)
	parent.add_child(field)
	return field


func _create_card() -> VBoxContainer:
	var card := PanelContainer.new()
	var style := StyleBoxFlat.new()
	style.bg_color = LIGHT_GREEN
	style.border_color = Color("#a6b8a0")
	style.set_border_width_all(1)
	style.set_corner_radius_all(8)
	style.set_content_margin_all(9.0)
	card.add_theme_stylebox_override("panel", style)
	var section := VBoxContainer.new()
	section.add_theme_constant_override("separation", 5)
	card.add_child(section)
	add_child(card)
	return section


func _text(parent: Node, text_value: String, size: int = 11, color: Color = TEXT_MUTED) -> Label:
	var label := Label.new()
	label.text = text_value
	label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	label.add_theme_font_size_override("font_size", size)
	label.add_theme_color_override("font_color", color)
	label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	parent.add_child(label)
	return label


func _format_status(value: String) -> String:
	return value.replace("_", " ").capitalize()


func _format_number(value: int) -> String:
	var digits := str(maxi(0, value))
	var grouped := ""
	for index in range(digits.length()):
		if index > 0 and (digits.length() - index) % 3 == 0:
			grouped += ","
		grouped += digits.substr(index, 1)
	return grouped


func _format_date(value: Variant) -> String:
	return _date_key(value) if value is Dictionary and not value.is_empty() else "date unavailable"


func _date_key(value: Dictionary) -> String:
	return (
		"%04d-%02d-%02d"
		% [int(value.get("year", 0)), int(value.get("month", 0)), int(value.get("day", 0))]
	)
