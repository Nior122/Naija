extends SceneTree
# Stage 44, optional phase "remaining": the owner's remaining business operations
# through the panel. HEADLESS, SIMULATED INPUT. It is not a rendered test.
# It runs on a fresh funded world and uses its own business D.
#
# Business D: created with N20,000 starting capital; Beans listed at N4,000;
#   price changed to N4,500; a price of N999,999 refused as outside the permitted
#   range; the listing taken off sale and back on; five branches opened and a
#   sixth refused at the limit; a transfer to the owner's own character and to an
#   unknown character refused; a close refused while D holds money; the balance
#   withdrawn; D closed; then the panel's "Open branch" on the closed D.
# Balances, stock, and branches are checked afterwards from the server's world
#   file (see the verification record).
#
# Requirements, set by the runner and never defaulted to a developer's own save:
#   NAIJA_WS_URL                    an isolated world server (a fresh copy)
#   NAIJA_MULTIPLAYER_SESSION_PATH  a config file holding the funded owner's token
#   NAIJA_UI_OWNER_ID               the owner's character ID, for the refused
#                                   self-transfer
#
# Run: godot --headless --path game --script res://tests/business_remaining_ui_headless.gd

const MAIN_SCENE := preload("res://scenes/main.tscn")
const DRIVER := preload("res://tests/business_ui_driver.gd")
const WATCHDOG_SECONDS := 420.0
const URL_ENV := "NAIJA_WS_URL"
const SESSION_ENV := "NAIJA_MULTIPLAYER_SESSION_PATH"
const OWNER_ENV := "NAIJA_UI_OWNER_ID"
const NO_SUCH_CHARACTER := "character-00000000-0000-4000-8000-00000000d00d"
# maximum_branches_per_business in game/data/businesses/catalog.json.
const BRANCH_LIMIT := 5

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
	var owner_id := OS.get_environment(OWNER_ENV).strip_edges()
	_d.check(not url.is_empty(), "NAIJA_WS_URL names an isolated world server")
	_d.check(not session_path.is_empty() and FileAccess.file_exists(session_path),
		"NAIJA_MULTIPLAYER_SESSION_PATH names an existing owner session file")
	_d.check(owner_id.begins_with("character-"), "NAIJA_UI_OWNER_ID is the owner's character ID")
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
	var cash_before: int = _d.naira_after(main, "Your cash: ")
	_d.check(cash_before == 400000,
		"the funded owner's server cash is N400,000 (shown: %d)" % cash_before)

	var suffix := str(Time.get_ticks_usec() % 100000)
	var name_d := "Stage44 D %s" % suffix

	# ---- 2. Create D with capital, then open it ----
	await _create(name_d, "20000", "A shop for the remaining Stage 44 operations.")
	_d.check(await _open(name_d), "business D opens from the owned list")

	# ---- 3. List Beans, then change its price ----
	var list_goods = await _d.wait_enabled_button("List goods")
	_d.check(list_goods != null, "'List goods' is offered to the owner")
	if list_goods != null:
		var goods_option: Array = _d.options_beside(list_goods)
		_d.check(not goods_option.is_empty() and _d.choose(goods_option[0], "Beans"),
			"the goods listing form offers Beans")
		var price_field = _d.field_beside(list_goods, "Selling price (₦)")
		if price_field != null:
			price_field.text = "4000"
		_d.activate(list_goods)
	_d.check(await _d.wait_label("Added 'Beans"), "the server confirms the Beans listing")

	await _set_price("4500")
	_d.check(await _d.wait_label("now sells at ₦4,500."),
		"the server confirms the new price of N4,500")

	await _set_price("999999")
	_d.check(await _d.wait_label("The price is outside the permitted range."),
		"the server refuses N999,999 as outside the permitted range")

	# ---- 4. Take the listing off sale, then back on ----
	var deactivate = await _d.wait_enabled_button("Deactivate")
	_d.check(deactivate != null, "'Deactivate' is offered for the Beans listing")
	if deactivate != null:
		_d.activate(deactivate)
	_d.check(await _d.wait_label("was taken off sale."), "the server takes Beans off sale")
	var reactivate = await _d.wait_enabled_button("Reactivate")
	_d.check(reactivate != null, "'Reactivate' is offered once the listing is off sale")
	if reactivate != null:
		_d.activate(reactivate)
	_d.check(await _d.wait_label("is back on sale."), "the server puts Beans back on sale")

	# ---- 5. Open branches up to the limit, then refuse one more ----
	for i in range(BRANCH_LIMIT):
		var branch_name: String = "%s Branch %d" % [name_d, i + 1]
		await _request_branch(branch_name)
		_d.check(await _d.wait_label("Branch '%s' opened." % branch_name),
			"the server opens branch %d of %d" % [i + 1, BRANCH_LIMIT])
	await _request_branch("%s Branch over the limit" % name_d)
	_d.check(await _d.wait_label("This business has reached its branch limit."),
		"the server refuses a branch beyond the limit of %d" % BRANCH_LIMIT)

	# ---- 6. Transfers that must be refused ----
	await _transfer_to(name_d, owner_id)
	_d.check(await _d.wait_label("Choose someone other than yourself to receive the business."),
		"the server refuses a transfer to the owner's own character")
	await _transfer_to(name_d, NO_SUCH_CHARACTER)
	_d.check(await _d.wait_label("That character does not exist in this world."),
		"the server refuses a transfer to a character that does not exist")

	# ---- 7. D holds money, so closing it is refused; withdraw, then close ----
	var close_refused = await _d.wait_card_button(name_d, "Close business")
	_d.check(close_refused != null, "'Close business' is offered for D while it holds money")
	if close_refused != null:
		_d.activate(close_refused)
	await _confirm()
	_d.check(await _d.wait_label("Withdraw the business balance before closing it."),
		"the server refuses to close D while it holds money")

	var balance: int = _d.naira_after(main, "Balance ")
	_d.check(balance > 0, "D shows a balance to withdraw (N%d)" % balance)
	var withdraw = await _d.wait_card_button(name_d, "Withdraw")
	_d.check(withdraw != null, "'Withdraw' is offered for D")
	if withdraw != null:
		var amount := _line_edit_beside(withdraw)
		if amount != null:
			amount.text = str(balance)
		_d.activate(withdraw)
	await _confirm()
	_d.check(await _d.wait_label("Withdrew %s from the business." % _naira_text(balance)),
		"the server confirms the withdrawal of D's whole balance")

	var close_d = await _d.wait_card_button(name_d, "Close business")
	_d.check(close_d != null, "'Close business' is offered for D once it is empty")
	if close_d != null:
		_d.activate(close_d)
	await _confirm()
	_d.check(await _d.wait_label("Business '%s' has been closed." % name_d),
		"the server closes D, which now has no balance")

	# ---- 8. The closed business: the panel's own action, which the server must refuse ----
	var late_branch = await _d.wait_enabled_button("Open branch")
	if late_branch == null:
		print("OBSERVED: the panel offers no 'Open branch' on the closed business D: true")
	else:
		print("OBSERVED: the panel offers 'Open branch' on the closed business D: true")
		await _request_branch("%s Late branch" % name_d)
		_d.check(await _d.wait_label("That business is not currently active."),
			"the server refuses a branch on the closed business D")

	print("businesses: D '%s' (closed after the checks)" % name_d)
	_finish()


## Sets the price of the listed Beans through the "Set price" control in the same row.
func _set_price(value: String) -> void:
	var set_price = await _d.wait_enabled_button("Set price")
	_d.check(set_price != null, "'Set price' is offered for the Beans listing")
	if set_price == null:
		return
	var price_field = _d.field_beside(set_price, "New price (₦)")
	_d.check(price_field != null, "the price row has a new-price field")
	if price_field != null:
		price_field.text = value
	_d.activate(set_price)


## Opens a branch through the "Open branch" form. The form does not ask for confirmation.
func _request_branch(branch_name: String) -> void:
	var open_branch = await _d.wait_enabled_button("Open branch")
	_d.check(open_branch != null, "'Open branch' is offered for D")
	if open_branch == null:
		return
	var branch_field = _d.field_beside(open_branch, "Branch name")
	_d.check(branch_field != null, "the branch row has a branch-name field")
	if branch_field != null:
		branch_field.text = branch_name
	_d.activate(open_branch)


## Fills the recipient field of the transfer for a business, presses the button, then confirms.
func _transfer_to(name: String, recipient_id: String) -> void:
	var transfer = await _d.wait_card_button(name, "Transfer ownership")
	_d.check(transfer != null, "'Transfer ownership' is offered for D")
	if transfer != null:
		var recipient = _d.field_beside(transfer, "Recipient character ID")
		_d.check(recipient != null, "the transfer row has a recipient field")
		if recipient != null:
			recipient.text = recipient_id
		_d.activate(transfer)
	await _confirm()


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


## Opens the business from the owned list; waits for its detail view ("Close details").
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


## The amount field in the same row as the button (the money forms keep them together).
func _line_edit_beside(button: Button) -> LineEdit:
	if button == null or button.get_parent() == null:
		return null
	for sibling in button.get_parent().get_children():
		if sibling is LineEdit:
			return sibling
	return null


## The naira text the panel uses, for example 48500 becomes "₦48,500".
func _naira_text(amount: int) -> String:
	var digits := str(amount)
	var out := ""
	var count := 0
	for index in range(digits.length() - 1, -1, -1):
		if count > 0 and count % 3 == 0:
			out = "," + out
		out = digits.substr(index, 1) + out
		count += 1
	return "₦" + out


func main_node() -> Node:
	return _d.main


func _finish() -> void:
	print("")
	var failed: int = _d.failures.size()
	if failed == 0:
		print("PASS: %d business remaining-operation UI checks (headless, simulated input)" % _d.checks)
		quit(0)
	else:
		print("FAIL: %d of %d business remaining-operation UI checks failed" % [failed, _d.checks])
		quit(1)
