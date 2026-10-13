extends SceneTree
# Stage 44, phase 1 of 5: the funded owner runs the business operations through the Godot
# panel.
# HEADLESS, SIMULATED INPUT. It is not a rendered test.
#
# Business A: create, list goods (Beans) and a service, restock, hire a worker, pay the worker,
#   open a branch, and try to close it while it holds money (refused). It stays open for the buyer.
# Business B: create with no capital, then close it. The balance is zero, so the close must succeed.
# Business C: create with no capital. It is transferred to the stranger in phase 4.
#
# The names are written to the state file for the later phases. Balances, stock, and the ledger are
# checked afterwards from the server's world file (see docs/STAGE_44_BUSINESS_VERIFICATION.md).
#
# Requirements, set by the runner, never defaulted to a developer's own save or server:
#   NAIJA_WS_URL                    an isolated world server (the runner uses a reset copy)
#   NAIJA_MULTIPLAYER_SESSION_PATH  a config file holding the funded owner's session token
#   NAIJA_UI_STATE_PATH             where the business names are written for the next phases
#   NAIJA_UI_CANDIDATE_ID           the character ID of the candidate to hire (from the fixture)
#
# Run: godot --headless --path game --script res://tests/business_owner_ops_ui_headless.gd

const MAIN_SCENE := preload("res://scenes/main.tscn")
const DRIVER := preload("res://tests/business_ui_driver.gd")
const WATCHDOG_SECONDS := 300.0
const URL_ENV := "NAIJA_WS_URL"
const SESSION_ENV := "NAIJA_MULTIPLAYER_SESSION_PATH"
const STATE_ENV := "NAIJA_UI_STATE_PATH"
const CANDIDATE_ENV := "NAIJA_UI_CANDIDATE_ID"

var _d: RefCounted = null


func _initialize() -> void:
	_d = DRIVER.new(self)
	create_timer(WATCHDOG_SECONDS).timeout.connect(_on_watchdog)
	call_deferred("_run")


func _on_watchdog() -> void:
	print("FAIL: watchdog after %.0f seconds" % WATCHDOG_SECONDS)
	quit(1)


func _run() -> void:
	var url := OS.get_environment(URL_ENV).strip_edges()
	var session_path := OS.get_environment(SESSION_ENV).strip_edges()
	var state_path := OS.get_environment(STATE_ENV).strip_edges()
	var candidate_id := OS.get_environment(CANDIDATE_ENV).strip_edges()
	_d.check(not url.is_empty(), "NAIJA_WS_URL names an isolated world server")
	_d.check(not session_path.is_empty() and FileAccess.file_exists(session_path),
		"NAIJA_MULTIPLAYER_SESSION_PATH names an existing owner session file")
	_d.check(not state_path.is_empty(), "NAIJA_UI_STATE_PATH is set")
	_d.check(candidate_id.begins_with("character-"), "NAIJA_UI_CANDIDATE_ID is a character ID")
	if _d.failures.size() > 0:
		_finish()
		return
	print("server URL: %s" % url)

	var main := MAIN_SCENE.instantiate()
	root.add_child(main)
	_d.main = main
	for i in range(3):
		await process_frame
	var proto: Node = main.mode_2d_instance
	_d.check(proto != null, "Main scene exposes the 2D session")
	if proto == null:
		_finish()
		return

	# ---- 1. Continue as the funded owner through the real start button ----
	var continue_button = _d.find_button(main, "Continue online life")
	_d.check(continue_button != null, "start screen offers 'Continue online life'")
	if continue_button != null:
		_d.activate(continue_button)
	_d.check(await _d.wait_for_session(proto), "online session becomes ready from the server")
	if not proto.playing:
		_finish()
		return

	var businesses = _d.find_button(main, "Businesses")
	_d.check(businesses != null, "HUD has the Businesses button")
	if businesses != null:
		_d.activate(businesses)
	_d.check(await _d.wait_label("Your cash"), "Businesses panel shows the server cash line")
	var cash_before = _d.naira_after(main, "Your cash: ")
	_d.check(cash_before == 400000,
		"the funded owner's server cash is N400,000 (shown: %d)" % cash_before)

	var suffix := str(Time.get_ticks_usec() % 100000)
	var name_a := "Stage44 A %s" % suffix
	var name_b := "Stage44 B %s" % suffix
	var name_c := "Stage44 C %s" % suffix

	# ---- 2. Create three businesses through the create form ----
	await _create(name_a, "50000", "A shop opened by the Stage 44 owner phase.")
	await _create(name_b, "", "A shop that is closed while empty.")
	await _create(name_c, "", "A shop that is transferred in phase 4.")

	# ---- 3. Business A: goods listing ----
	_d.check(await _open(name_a), "business A opens from the owned list")
	var list_goods = await _d.wait_enabled_button("List goods")
	_d.check(list_goods != null, "'List goods' is offered to the owner")
	if list_goods != null:
		var goods_option = _d.options_beside(list_goods)
		var price_field = _d.field_beside(list_goods, "Selling price (₦)")
		_d.check(not goods_option.is_empty() and _d.choose(goods_option[0], "Beans"),
			"the goods listing form offers Beans")
		if price_field != null:
			price_field.text = "4000"
		_d.activate(list_goods)
	_d.check(await _d.wait_label("Added 'Beans"), "the server confirms the Beans listing")
	_d.check(_d.label_contains(main, "4,000"), "the listed Beans price is shown as N4,000")

	# ---- 4. Business A: service listing at the catalogue price ----
	var list_service = await _d.wait_enabled_button("List service")
	_d.check(list_service != null, "'List service' is offered to the owner")
	var service_name: String = ""
	var service_price := 0
	if list_service != null:
		var service_option = _d.options_beside(list_service)
		var offered = service_option[0] if not service_option.is_empty() else null
		_d.check(offered != null and offered.item_count > 0, "the service listing form offers services")
		if offered != null and offered.item_count > 0:
			_d.check(_d.choose(offered, "Local Delivery"), "the service listing form offers Local Delivery")
			var label: String = offered.get_item_text(offered.selected)
			var split: int = label.find(" (catalogue price")
			service_name = label.substr(0, split) if split > 0 else label
			var regex := RegEx.new()
			regex.compile("catalogue price ₦([0-9,]+)")
			var found = regex.search(label)
			service_price = int(found.get_string(1).replace(",", "")) if found != null else 0
		var price_field = _d.field_beside(list_service, "Price (₦)")
		if price_field != null and service_price > 0:
			price_field.text = str(service_price)
		_d.activate(list_service)
	_d.check(service_price > 0, "the catalogue price of the service is known (%d)" % service_price)
	_d.check(await _d.wait_label("Listed the service"), "the server confirms the service listing")

	# ---- 5. Business A: restock, confirmed ----
	var restock = await _d.wait_enabled_button("Restock")
	_d.check(restock != null, "'Restock' is offered to the owner")
	if restock != null:
		var restock_option = _d.options_beside(restock)
		_d.check(not restock_option.is_empty() and _d.choose(restock_option[0], "Beans"),
			"the restock form offers Beans")
		var units = _d.field_beside(restock, "Units")
		var cost = _d.field_beside(restock, "Unit cost (₦)")
		if units != null:
			units.text = "5"
		if cost != null:
			cost.text = "1000"
		_d.activate(restock)
	_d.check(await _d.wait_label("Restock 5 units"), "restocking asks for confirmation")
	await _confirm()
	_d.check(await _d.wait_label("Restocked 5 units"), "the server confirms the restock of 5 units")

	# ---- 6. Business A: hire the candidate, then pay them ----
	var hire = await _d.wait_enabled_button("Hire")
	_d.check(hire != null, "'Hire' is offered to the owner")
	if hire != null:
		var employee = _d.field_beside(hire, "Employee character ID")
		if employee != null:
			employee.text = candidate_id
		_d.activate(hire)
	_d.check(await _d.wait_label("Employee %s hired." % candidate_id),
		"the server confirms the hire of the candidate")

	var pay = await _d.wait_enabled_button("Pay salary")
	_d.check(pay != null, "'Pay salary' is offered once the candidate is an active employee")
	if pay != null:
		var amount = _d.field_beside(pay, "Amount (₦)")
		if amount != null:
			amount.text = "2000"
		_d.activate(pay)
	await _confirm()
	_d.check(await _d.wait_label("Salary of ₦2,000 paid."), "the server confirms the salary of N2,000")

	# ---- 7. Business A: open a branch ----
	var open_branch = await _d.wait_enabled_button("Open branch")
	_d.check(open_branch != null, "'Open branch' is offered to the owner")
	var branch_name := "Stage44 Branch %s" % suffix
	if open_branch != null:
		var branch_field = _d.field_beside(open_branch, "Branch name")
		if branch_field != null:
			branch_field.text = branch_name
		_d.activate(open_branch)
	_d.check(await _d.wait_label("Branch '%s' opened." % branch_name),
		"the server confirms the branch")

	# ---- 8. Business A holds money, so closing it is refused ----
	var close_a = await _d.wait_enabled_button("Close business")
	_d.check(close_a != null, "'Close business' is offered for A")
	if close_a != null:
		_d.activate(close_a)
	await _confirm()
	_d.check(await _d.wait_label("Withdraw the business balance before closing it."),
		"the server refuses to close A while it holds money")
	_d.check(_d.label_contains(main, name_a), "business A is still listed after the refused close")

	# ---- 9. Business B has no balance, so closing it succeeds ----
	_d.check(await _open_again_from_list(name_a, "Close details"), "the owned list is shown again")
	_d.check(await _open(name_b), "business B opens from the owned list")
	var close_b = await _d.wait_enabled_button("Close business")
	_d.check(close_b != null, "'Close business' is offered for B")
	if close_b != null:
		_d.activate(close_b)
	await _confirm()
	var closed_b: bool = await _d.wait_label("Business '%s' has been closed." % name_b)
	if not closed_b:
		_d.print_labels(main, "Too many")
		_d.print_labels(main, "could not")
		_d.print_labels(main, "close")
	_d.check(closed_b, "the server closes B, which has no balance")

	# ---- 10. Hand the state to the next phases ----
	var state := {
		"business_a": name_a,
		"business_b": name_b,
		"business_c": name_c,
		"branch": branch_name,
		"service_name": service_name,
		"service_price": service_price,
		"candidate_id": candidate_id,
	}
	var file := FileAccess.open(state_path, FileAccess.WRITE)
	_d.check(file != null, "the state file can be written")
	if file != null:
		file.store_string(JSON.stringify(state, "  "))
		file.close()
	print("businesses: A '%s' (kept), B '%s' (closed), C '%s' (kept for transfer)" % [
		name_a, name_b, name_c,
	])
	_finish()


## Creates a business through the create form and waits for the server's registration reply.
func _create(name: String, capital: String, description: String) -> void:
	await _d.pace()
	var name_edit = _d.find_line_edit(main_node(), "Business name")
	var description_edit = _d.find_line_edit(main_node(), "Describe the business")
	var capital_edit = _d.find_line_edit(main_node(), "Starting capital (₦, optional)")
	_d.check(name_edit != null and description_edit != null and capital_edit != null,
		"the create form has its name, description, and capital fields")
	if name_edit != null:
		name_edit.text = name
	if description_edit != null:
		description_edit.text = description
	if capital_edit != null:
		capital_edit.text = capital
	var template = _d.find_option(main_node(), "Provision Store")
	_d.check(template != null and _d.choose(template, "Provision Store"),
		"the create form offers the Provision Store template")
	var create = await _d.wait_enabled_button_now("Start business")
	_d.check(create != null, "'Start business' is enabled before creating '%s'" % name)
	if create != null:
		_d.activate(create)
	await _confirm()
	_d.check(await _d.wait_label("Business '%s' has been registered." % name),
		"the server registers '%s'" % name)


## Confirms the pending change, if the panel asks for confirmation.
func _confirm() -> void:
	var confirm = await _d.wait_enabled_button("Confirm")
	_d.check(confirm != null, "the panel asks for confirmation first")
	if confirm != null:
		_d.activate(confirm)


## Opens the business from the owned list (the "My businesses" tab is the default). Waits for the
## detail view of this business: its own card holds "Close details" only in the detail view.
func _open(name: String) -> bool:
	var open = await _d.wait_card_button(name, "Open")
	if open == null:
		return false
	_d.activate(open)
	for i in range(1500):
		if _d.card_button(main_node(), name, "Close details") != null:
			return true
		await main_node().get_tree().process_frame
	return false


func _open_again_from_list(name: String, close_text: String) -> bool:
	var close = await _d.wait_enabled_button(close_text)
	if close == null:
		return false
	_d.activate(close)
	return await _d.wait_card_button(name, "Open") != null


func main_node() -> Node:
	return _d.main


func _finish() -> void:
	print("")
	var failed: int = _d.failures.size()
	if failed == 0:
		print("PASS: %d business owner-phase UI checks (headless, simulated input)" % _d.checks)
		quit(0)
	else:
		print("FAIL: %d of %d business owner-phase UI checks failed" % [failed, _d.checks])
		quit(1)
