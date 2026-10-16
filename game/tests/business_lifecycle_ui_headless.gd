extends SceneTree
# Stage 44 business lifecycle through the Godot business panel.
# HEADLESS, SIMULATED INPUT. It is not a rendered test.
#
# What it drives: the start screen's "Continue online life" button, the HUD "Businesses" button,
# then the panel's own controls: the create form, the Confirm and Cancel buttons, "Open",
# "List goods", "Restock" and "Close business". Buttons are activated by focusing them and sending
# ui_accept, as the other headless tests do. Text fields are set through LineEdit.text, and
# dropdowns through OptionButton.select (the popup is not driven). Each result is read back from the
# label the panel shows, which the server's reply sets.
#
# It does not assert the server's ledger or stock itself. Those are checked afterwards from the
# server's world file with tools/business-fixture/provision.mjs report (see
# docs/STAGE_44_BUSINESS_VERIFICATION.md).
#
# Requirements, both set by the runner and never defaulted to the developer's own save or server:
#   NAIJA_WS_URL                    an isolated world server (the runner uses a reset copy)
#   NAIJA_MULTIPLAYER_SESSION_PATH  a config file holding a funded owner's session token,
#                                   kept outside the repository
#
# Run: godot --headless --path game --script res://tests/business_lifecycle_ui_headless.gd

const MAIN_SCENE := preload("res://scenes/main.tscn")
const WATCHDOG_SECONDS := 240.0
const SESSION_WAIT_FRAMES := 1800
const REPLY_WAIT_FRAMES := 1500
const SESSION_ENV := "NAIJA_MULTIPLAYER_SESSION_PATH"
const URL_ENV := "NAIJA_WS_URL"

var _checks: int = 0
var _failures: Array[String] = []
var _main: Node = null


func _initialize() -> void:
	create_timer(WATCHDOG_SECONDS).timeout.connect(_on_watchdog)
	call_deferred("_run")


func _check(condition: bool, label: String) -> void:
	_checks += 1
	if not condition:
		_failures.append(label)
		print("CHECK FAILED: %s" % label)


func _observe(label: String) -> void:
	print("OBSERVED: %s" % label)


func _on_watchdog() -> void:
	print("FAIL: watchdog after %.0f seconds" % WATCHDOG_SECONDS)
	quit(1)


func _frames(count: int) -> void:
	for i in range(count):
		await process_frame


func _find_button(node: Node, text: String) -> Button:
	if node.is_queued_for_deletion():
		return null
	if node is Button and (node as Button).text == text and (node as Button).is_visible_in_tree():
		return node
	for child in node.get_children():
		var found := _find_button(child, text)
		if found != null:
			return found
	return null


func _find_line_edit(node: Node, placeholder: String) -> LineEdit:
	if node.is_queued_for_deletion():
		return null
	if node is LineEdit and (node as LineEdit).placeholder_text == placeholder:
		return node
	for child in node.get_children():
		var found := _find_line_edit(child, placeholder)
		if found != null:
			return found
	return null


## The first dropdown under node that offers an item containing the text.
func _find_option(node: Node, contains: String) -> OptionButton:
	if node.is_queued_for_deletion():
		return null
	if node is OptionButton:
		var option := node as OptionButton
		for index in range(option.item_count):
			if option.get_item_text(index).contains(contains):
				return option
	for child in node.get_children():
		var found := _find_option(child, contains)
		if found != null:
			return found
	return null


## The dropdown in the same row as this field (the goods forms each have one row per field).
func _option_in_row_of(field: LineEdit) -> OptionButton:
	if field == null or field.get_parent() == null:
		return null
	for sibling in field.get_parent().get_children():
		if sibling is OptionButton:
			return sibling
	return null


## Chooses the first item containing the text, and sends the signal the control sends on a choice.
func _choose(option: OptionButton, contains: String) -> bool:
	for index in range(option.item_count):
		if option.get_item_text(index).contains(contains):
			option.select(index)
			option.item_selected.emit(index)
			return true
	return false


func _label_contains(node: Node, text: String) -> bool:
	if node.is_queued_for_deletion():
		return false
	if node is Label and (node as Label).is_visible_in_tree() and (node as Label).text.contains(text):
		return true
	for child in node.get_children():
		if _label_contains(child, text):
			return true
	return false


func _activate(button: Button) -> void:
	# Real GUI activation: focus the button, then send ui_accept press and release.
	button.grab_focus()
	var down := InputEventAction.new()
	down.action = "ui_accept"
	down.pressed = true
	root.push_input(down)
	var up := InputEventAction.new()
	up.action = "ui_accept"
	up.pressed = false
	root.push_input(up)


## Waits until a button with this text exists and is enabled. Returns it, or null on timeout.
func _wait_enabled_button(text: String) -> Button:
	for i in range(REPLY_WAIT_FRAMES):
		var button := _find_button(_main, text)
		if button != null and not button.disabled:
			return button
		await process_frame
	return null


func _wait_label(text: String) -> bool:
	for i in range(REPLY_WAIT_FRAMES):
		if _label_contains(_main, text):
			return true
		await process_frame
	return false


func _run() -> void:
	var url := OS.get_environment(URL_ENV).strip_edges()
	var session_path := OS.get_environment(SESSION_ENV).strip_edges()
	_check(not url.is_empty(), "NAIJA_WS_URL names an isolated world server")
	_check(not session_path.is_empty() and FileAccess.file_exists(session_path),
		"NAIJA_MULTIPLAYER_SESSION_PATH names an existing funded-owner session file")
	if _failures.size() > 0:
		_finish()
		return
	_observe("server URL: %s" % url)

	_main = MAIN_SCENE.instantiate()
	root.add_child(_main)
	await _frames(3)
	var proto: Node = _main.mode_2d_instance
	_check(proto != null, "Main scene exposes the 2D session")
	if proto == null:
		_finish()
		return

	# ---- 1. Start screen: continue as the funded owner through the real button ----
	var continue_button := _find_button(_main, "Continue online life")
	_check(continue_button != null, "start screen offers 'Continue online life' for the saved session")
	if continue_button != null:
		_activate(continue_button)
	var waited := 0
	while not proto.playing and waited < SESSION_WAIT_FRAMES:
		await process_frame
		waited += 1
	_check(proto.playing, "online session becomes ready from the server")
	if not proto.playing:
		_finish()
		return
	_check(proto._online_mode, "session is in online mode")

	# ---- 2. Open Businesses from the HUD ----
	var businesses := _find_button(_main, "Businesses")
	_check(businesses != null, "HUD has the Businesses button")
	if businesses != null:
		_activate(businesses)
	_check(await _wait_label("Your cash"), "Businesses panel shows the server cash line")
	_check(_label_contains(proto.ui, "400,000"), "the funded owner's server cash is shown (N400,000)")
	_check(_label_contains(proto.ui, "Start a business"), "the create form is offered")

	# ---- 3. Start a business through the create form ----
	var suffix := str(Time.get_ticks_usec() % 100000)
	var business_name := "Stage44 UI %s" % suffix
	var name_edit := _find_line_edit(proto.ui, "Business name")
	var description_edit := _find_line_edit(proto.ui, "Describe the business")
	var capital_edit := _find_line_edit(proto.ui, "Starting capital (₦, optional)")
	_check(name_edit != null and description_edit != null and capital_edit != null,
		"create form has its name, description and capital fields")
	if name_edit != null:
		name_edit.text = business_name
	if description_edit != null:
		description_edit.text = "A shop opened by the Stage 44 UI test."
	if capital_edit != null:
		capital_edit.text = "50000"
	var template_option := _find_option(proto.ui, "Provision Store")
	_check(template_option != null and _choose(template_option, "Provision Store"),
		"create form offers the Provision Store template")
	var create := await _wait_enabled_button("Start business")
	_check(create != null, "'Start business' is enabled when no request is pending")
	if create != null:
		_activate(create)
	var confirm := await _wait_enabled_button("Confirm")
	_check(confirm != null, "creating asks for confirmation first, with an enabled Confirm button")
	if confirm != null:
		_activate(confirm)
	_check(await _wait_label("has been registered"), "the server reports the business as registered")
	_check(_label_contains(proto.ui, business_name), "the new business is shown by name")

	# ---- 4. Open the business ----
	var open := await _wait_enabled_button("Open")
	_check(open != null, "the owned list offers Open for the new business")
	if open != null:
		_activate(open)
	_check(await _wait_label("List a stock good for sale"),
		"the business detail shows the goods listing form")

	# ---- 5. List a stock good with a price inside the markup limits ----
	var price_edit := _find_line_edit(proto.ui, "Selling price (₦)")
	_check(price_edit != null, "the listing form has the selling price field")
	var listing_option := _option_in_row_of(price_edit)
	_check(listing_option != null and _choose(listing_option, "Beans"),
		"the listing form offers Beans")
	if price_edit != null:
		price_edit.text = "4000"
	var list_goods := await _wait_enabled_button("List goods")
	_check(list_goods != null, "'List goods' is enabled")
	if list_goods != null:
		_activate(list_goods)
	_check(await _wait_label("Added 'Beans"), "the server confirms the Beans listing")
	_check(_label_contains(proto.ui, "4,000"), "the listed price is shown as N4,000")

	# ---- 6. Restock with a valid quantity, confirmed ----
	var units_edit := _find_line_edit(proto.ui, "Units")
	var cost_edit := _find_line_edit(proto.ui, "Unit cost (₦)")
	var restock_option := _option_in_row_of(units_edit)
	_check(restock_option != null and _choose(restock_option, "Beans"),
		"the restock form offers Beans")
	var restock_choice := ""
	if restock_option != null and restock_option.selected >= 0:
		restock_choice = restock_option.get_item_text(restock_option.selected)
	_check(restock_choice.contains("Beans"), "the restock form has Beans selected before submitting")
	if units_edit != null:
		units_edit.text = "5"
	if cost_edit != null:
		cost_edit.text = "1000"
	var restock := await _wait_enabled_button("Restock")
	_check(restock != null, "'Restock' is enabled")
	if restock != null:
		_activate(restock)
	_check(await _wait_label("Restock 5 units"), "restocking asks for confirmation with the units")
	var restock_confirm := await _wait_enabled_button("Confirm")
	if restock_confirm != null:
		_activate(restock_confirm)
	_check(await _wait_label("Restocked 5 units"), "the server confirms the restock of 5 units")

	# ---- 7. Closing with a nonzero balance is refused, and the business stays open ----
	var close := await _wait_enabled_button("Close business")
	_check(close != null, "'Close business' is offered")
	if close != null:
		_activate(close)
	_check(await _wait_label("Ask the server to close"), "closing asks for confirmation first")
	var close_confirm := await _wait_enabled_button("Confirm")
	if close_confirm != null:
		_activate(close_confirm)
	_check(await _wait_label("Withdraw the business balance before closing it."),
		"the server refuses the close with a nonzero balance, and says why")
	_check(_label_contains(proto.ui, business_name),
		"the business is still listed after the refused close")

	_observe("business created: %s" % business_name)
	_finish()


func _finish() -> void:
	if _failures.is_empty():
		print("PASS: %d business lifecycle UI checks (headless, simulated input)" % _checks)
		quit(0)
	else:
		print("FAIL: %d of %d checks failed" % [_failures.size(), _checks])
		for label in _failures:
			print("  - %s" % label)
		quit(1)
