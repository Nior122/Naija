class_name BusinessPanel
extends VBoxContainer

## Business screen (Stage 41). It shows the player's own businesses, a discovery list, and a detail
## view with balances, products, inventory, employees, transactions and sales. Every change is sent
## to the server as business.action. The screen changes state only from the server's reply
## (business.result) or from a character snapshot. A money-moving action asks for confirmation
## first, and the confirmation names the balance that pays.

signal business_action_requested(action: String, payload: Dictionary, request_id: String)

const TEXT_DARK := Color("#27352b")
const TEXT_MUTED := Color("#657466")
const GREEN := Color("#39734a")
const WARNING := Color("#8a3b2a")
const LIGHT_GREEN := Color("#e6eee2")
const TAB_IDS: Array[String] = ["owned", "discover"]
const TAB_LABELS: Dictionary = {"owned": "My businesses", "discover": "Discover"}
const OWNER_ROLES: Array[String] = ["owner", "co_owner"]

var _online := false
var _character_id := ""
var _money := 0
var _rules: Dictionary = {}
var _tracker := ServerRequestTracker.new()
var _tab := "owned"
var _notice := ""
var _owned: Array = []
var _discovered: Array = []
var _details: Dictionary = {}
var _selected_id := ""
var _confirm: Dictionary = {}
var _inputs: Array = []


## Sets the signed-in character, their cash, the catalogue limits, and whether the shared world is
## connected. Opening the screen loads the discovery list.
func configure(character_id: String, money: int, rules: Dictionary, is_online: bool) -> void:
	_character_id = character_id
	_money = money
	_rules = rules.duplicate(true)
	_online = is_online
	_render()
	if _online:
		_read("discover", {})


## The UI layer owns the tracker, so a request keeps its state while the panel is closed.
func bind_tracker(tracker: ServerRequestTracker) -> void:
	_tracker = tracker
	_render()


## Stores the businesses the character owns (from a character snapshot). It does not rebuild the
## screen while the player is typing, so their entry is kept.
func show_profiles(profiles: Array, money: int) -> void:
	_owned = profiles.duplicate(true)
	_money = money
	if _input_has_focus():
		return
	_render()


## Applies a business.result or business.error. The UI layer has already updated the tracker and
## passes answered = true when the reply answered the pending request. A reply to a pending request
## refreshes the open business.
func apply_server_response(message: Dictionary, answered: bool) -> void:
	var response_type := str(message.get("type", ""))
	if response_type != "business.result" and response_type != "business.error":
		return
	var action := str(message.get("action", ""))
	if response_type == "business.error":
		_notice = str(message.get("message", "The server refused this business request."))
		_render()
		return
	_notice = str(message.get("message", "Done."))
	var data: Variant = message.get("data", {})
	if data is Dictionary:
		_apply_result(action, data)
	if answered and not _selected_id.is_empty():
		_read("view", {"business_id": _selected_id})
	_render()


## Shows a notice from the UI layer, such as a lost connection, a timeout, or a request that could
## not be sent.
func show_notice_text(text_value: String) -> void:
	_notice = text_value
	_render()


func _apply_result(action: String, data: Dictionary) -> void:
	match action:
		"discover":
			var businesses: Variant = data.get("businesses", [])
			if businesses is Array:
				_discovered = businesses.duplicate(true)
		"view":
			var profile: Variant = data.get("business_profile", {})
			if profile is Dictionary and not str(profile.get("business_id", "")).is_empty():
				_details[str(profile.get("business_id", ""))] = profile.duplicate(true)
		_:
			pass


# --- Requests ---


## A read-only request. It is not tracked as pending.
func _read(action: String, payload: Dictionary) -> void:
	if not _online:
		return
	business_action_requested.emit(action, payload.duplicate(true), "")


## A changing request. Only one may be pending; the controls that send one are disabled while it
## waits.
func _change(action: String, payload: Dictionary) -> void:
	if not _online:
		_notice = "Business changes need the connected shared world."
		_render()
		return
	var request_id := _tracker.begin(action, payload)
	if request_id.is_empty():
		_notice = "Another business request is still waiting. Wait for the server to answer it first."
		_render()
		return
	_notice = "Sent to the shared business service. Waiting for the server to confirm…"
	_render()
	business_action_requested.emit(action, payload.duplicate(true), request_id)


func _confirm_change(action: String, payload: Dictionary, label: String) -> void:
	_confirm = {"action": action, "payload": payload.duplicate(true), "label": label}
	_render()


# --- Rendering ---


func _render() -> void:
	for child in get_children():
		child.queue_free()
	_inputs.clear()
	if not _online:
		_add_text(
			"Businesses are available in the connected shared world only. Balances, stock and sales "
			+ "are recorded by the server, so this screen shows no local placeholder.",
			13,
			TEXT_MUTED,
		)
		return
	_add_text("Your cash: %s" % PropertyBusinessContract.naira(_money), 13, TEXT_DARK)
	if not _notice.is_empty():
		_add_text(_notice, 13, WARNING if _tracker.is_unconfirmed() else GREEN)
	_add_pending_box()
	if not _confirm.is_empty():
		_add_confirm_box()
	_add_tab_bar()
	if not _selected_id.is_empty():
		_add_detail()
	if _tab == "owned":
		_add_owned()
	else:
		_add_discover()


func _add_pending_box() -> void:
	if not _tracker.has_pending():
		return
	if _tracker.is_waiting():
		_add_text("A change is waiting for the server. Other changes are paused until it is answered.",
			12,
			TEXT_MUTED)
		return
	var row := HBoxContainer.new()
	add_child(row)
	var retry := _button("Retry the same request")
	retry.pressed.connect(_retry_pending)
	row.add_child(retry)
	var discard := _button("Discard")
	discard.pressed.connect(_discard_pending)
	row.add_child(discard)
	_add_text(
		"Retrying sends the same request ID, so the server applies it at most once. Discarding does not "
		+ "undo a change that was already saved; the records show the current state.",
		11,
		TEXT_MUTED,
	)


func _add_confirm_box() -> void:
	var card := _card()
	_add_text(str(_confirm.get("label", "Confirm this action?")), 13, TEXT_DARK, card)
	var row := HBoxContainer.new()
	card.add_child(row)
	var yes := _button("Confirm")
	yes.disabled = _tracker.has_pending()
	yes.pressed.connect(_on_confirm_pressed)
	row.add_child(yes)
	var no := _button("Cancel")
	no.pressed.connect(_on_confirm_cancelled)
	row.add_child(no)


func _add_tab_bar() -> void:
	var row := HBoxContainer.new()
	add_child(row)
	for tab_id in TAB_IDS:
		var button := _button(str(TAB_LABELS.get(tab_id, tab_id)))
		button.disabled = _tab == tab_id
		button.pressed.connect(_on_tab_pressed.bind(tab_id))
		row.add_child(button)


func _add_owned() -> void:
	if _owned.is_empty():
		_add_text(
			"You do not own or co-own a business yet. Discover businesses to buy from, or ask the "
			+ "server's creation flow once it is available here.",
			12,
			TEXT_MUTED,
		)
		return
	for profile in _owned:
		if profile is Dictionary:
			var card := _card()
			_add_text(str(profile.get("name", "Business")), 14, TEXT_DARK, card)
			_add_text(
				"%s · %s · balance %s" % [
					str(profile.get("category_label", "")),
					PropertyBusinessContract.label_for(str(profile.get("status", ""))),
					PropertyBusinessContract.naira(profile.get("balance_ngn", 0)),
				],
				11,
				TEXT_MUTED,
				card,
			)
			var role := PropertyBusinessContract.role_of(profile, _character_id)
			_add_text("Your role: %s" % PropertyBusinessContract.label_for(role), 11, TEXT_DARK, card)
			var open := _button("Open")
			open.pressed.connect(_on_open_pressed.bind(str(profile.get("business_id", ""))))
			card.add_child(open)


func _add_discover() -> void:
	if _discovered.is_empty():
		_add_text("No active businesses are listed yet. Refresh later.", 12, TEXT_MUTED)
	else:
		for entry in _discovered:
			if entry is Dictionary:
				_add_discovery_row(entry)
	var refresh := _button("Refresh list")
	refresh.disabled = not _online
	refresh.pressed.connect(_on_refresh_pressed)
	add_child(refresh)


func _add_discovery_row(entry: Dictionary) -> void:
	var card := _card()
	_add_text(str(entry.get("name", "Business")), 14, TEXT_DARK, card)
	_add_text(
		"%s · %s · %d products · %d employees · reputation %d" % [
			str(entry.get("category_label", "")),
			PropertyBusinessContract.label_for(str(entry.get("status", ""))),
			int(entry.get("product_count", 0)),
			int(entry.get("employee_count", 0)),
			int(entry.get("reputation_score", 0)),
		],
		11,
		TEXT_MUTED,
		card,
	)
	var view := _button("View")
	view.pressed.connect(_on_open_pressed.bind(str(entry.get("business_id", ""))))
	card.add_child(view)


func _add_detail() -> void:
	var profile := _profile_for(_selected_id)
	var card := _card()
	if profile.is_empty():
		_add_text("Loading this business from the server…", 12, TEXT_MUTED, card)
	else:
		_add_business_profile(card, profile)
	var close := _button("Close details")
	close.pressed.connect(_on_close_details_pressed)
	card.add_child(close)


func _add_business_profile(card: VBoxContainer, profile: Dictionary) -> void:
	var role := PropertyBusinessContract.role_of(profile, _character_id)
	var is_member := not role.is_empty()
	_add_text(str(profile.get("name", "Business")), 15, TEXT_DARK, card)
	_add_text(str(profile.get("description", "")), 12, TEXT_MUTED, card)
	_add_text(
		"%s · %s · %s · %s" % [
			str(profile.get("category_label", "")),
			str(profile.get("template_label", "")),
			PropertyBusinessContract.label_for(str(profile.get("status", ""))),
			PropertyBusinessContract.label_for(str(profile.get("premises_type", ""))),
		],
		12,
		TEXT_DARK,
		card,
	)
	_add_text(
		"Your role: %s" % (PropertyBusinessContract.label_for(role) if is_member
			else "none (you are a buyer here)"),
		12,
		TEXT_DARK,
		card,
	)
	_add_account_section(card, profile)
	_add_owners_section(card, profile)
	_add_products_section(card, profile, is_member)
	_add_inventory_section(card, profile)
	_add_transactions_section(card, profile)
	_add_sales_section(card, profile)
	if is_member:
		_add_owner_actions(card, profile, role)


func _add_account_section(card: VBoxContainer, profile: Dictionary) -> void:
	_add_text("Account", 13, TEXT_DARK, card)
	_add_text(
		"Balance %s · revenue %s · expenses %s · capital in %s · withdrawn %s · reputation %d" % [
			PropertyBusinessContract.naira(profile.get("balance_ngn", 0)),
			PropertyBusinessContract.naira(profile.get("total_revenue_ngn", 0)),
			PropertyBusinessContract.naira(profile.get("total_expenses_ngn", 0)),
			PropertyBusinessContract.naira(profile.get("total_capital_ngn", 0)),
			PropertyBusinessContract.naira(profile.get("total_withdrawals_ngn", 0)),
			int(profile.get("reputation_score", 0)),
		],
		11,
		TEXT_MUTED,
		card,
	)
	var pending: Variant = profile.get("pending_expenses", [])
	if pending is Array and not pending.is_empty():
		_add_text("%d expense(s) waiting to be paid." % pending.size(), 11, WARNING, card)


func _add_owners_section(card: VBoxContainer, profile: Dictionary) -> void:
	_add_text("Owners and staff", 13, TEXT_DARK, card)
	var owners := PropertyBusinessContract.active_owners(profile)
	if owners.is_empty():
		_add_text("No active owners or staff are recorded.", 11, TEXT_MUTED, card)
		return
	for row in owners:
		_add_text(
			"%s — %s" % [str(row.get("character_id", "")),
				PropertyBusinessContract.label_for(str(row.get("role", "")))],
			11,
			TEXT_MUTED,
			card,
		)


func _add_products_section(card: VBoxContainer, profile: Dictionary, is_member: bool) -> void:
	_add_text("Products and services", 13, TEXT_DARK, card)
	var products: Variant = profile.get("products", [])
	if not products is Array or products.is_empty():
		_add_text("No products or services are listed.", 11, TEXT_MUTED, card)
		return
	for product in products:
		if product is Dictionary:
			_add_product_row(card, profile, product, is_member)


func _add_product_row(card: VBoxContainer, profile: Dictionary, product: Dictionary,
	is_member: bool) -> void:
	var definition_id := str(product.get("product_definition_id", ""))
	var is_service := PropertyBusinessContract.is_service_product(definition_id)
	var available := bool(product.get("available", false))
	var label := "%s — %s%s%s" % [
		str(product.get("display_name", "Product")),
		PropertyBusinessContract.naira(product.get("price_ngn", 0)),
		" (service)" if is_service else "",
		"" if available else " · unavailable",
	]
	_add_text(label, 12, TEXT_DARK, card)
	if is_member or not available or str(profile.get("status", "")) != "active":
		return
	var row := HBoxContainer.new()
	card.add_child(row)
	var record_id := str(product.get("product_record_id", ""))
	var business_id := str(profile.get("business_id", ""))
	var name_text := str(product.get("display_name", "this item"))
	var price := int(product.get("price_ngn", 0))
	if is_service:
		var buy_service := _button("Buy service")
		buy_service.disabled = _tracker.has_pending()
		buy_service.pressed.connect(func():
			_confirm_change("buy_service", {"business_id": business_id, "product_record_id": record_id},
				"Buy %s for %s from your own cash?" % [name_text, PropertyBusinessContract.naira(price)]))
		row.add_child(buy_service)
		return
	var quantity := _line_edit("Qty")
	quantity.text = "1"
	row.add_child(quantity)
	var buy := _button("Buy")
	buy.disabled = _tracker.has_pending()
	buy.pressed.connect(func():
		var count := PropertyBusinessContract.parse_whole(quantity.text)
		if count < 1:
			_notice = "Enter a whole number of at least 1."
			_render()
			return
		_confirm_change("buy_product", {"business_id": business_id, "product_record_id": record_id,
			"quantity": count},
			"Buy %d × %s for %s from your own cash?" % [
				count, name_text, PropertyBusinessContract.naira(price * count),
			]))
	row.add_child(buy)


func _add_inventory_section(card: VBoxContainer, profile: Dictionary) -> void:
	var rows: Variant = profile.get("inventory", [])
	if not rows is Array or rows.is_empty():
		return
	_add_text("Stock", 13, TEXT_DARK, card)
	for row in rows:
		if row is Dictionary:
			var definition := PropertyBusinessContract.product_definition(
				str(row.get("product_definition_id", "")))
			_add_text(
				"%s — %d in stock · cost %s each · reorder at %d" % [
					str(definition.get("label", row.get("product_definition_id", ""))),
					int(row.get("quantity", 0)),
					PropertyBusinessContract.naira(row.get("unit_cost_ngn", 0)),
					int(row.get("reorder_threshold", 0)),
				],
				11,
				TEXT_MUTED,
				card,
			)


func _add_transactions_section(card: VBoxContainer, profile: Dictionary) -> void:
	var rows: Variant = profile.get("recent_transactions", [])
	_add_text("Recent transactions", 13, TEXT_DARK, card)
	if not rows is Array or rows.is_empty():
		_add_text("No transactions yet.", 11, TEXT_MUTED, card)
		return
	var shown := 0
	for row in rows:
		if row is Dictionary and shown < 8:
			shown += 1
			_add_text(
				"%s · %s · %s · balance %s — %s" % [
					PropertyBusinessContract.date_text(row.get("world_date", {})),
					PropertyBusinessContract.label_for(str(row.get("kind", ""))),
					PropertyBusinessContract.naira(row.get("amount_ngn", 0)),
					PropertyBusinessContract.naira(row.get("balance_after_ngn", 0)),
					str(row.get("description", "")),
				],
				11,
				TEXT_MUTED,
				card,
			)


func _add_sales_section(card: VBoxContainer, profile: Dictionary) -> void:
	var rows: Variant = profile.get("recent_sales", [])
	if not rows is Array or rows.is_empty():
		return
	_add_text("Recent sales", 13, TEXT_DARK, card)
	var shown := 0
	for row in rows:
		if row is Dictionary and shown < 8:
			shown += 1
			var definition := PropertyBusinessContract.product_definition(
				str(row.get("product_definition_id", "")))
			_add_text(
				"%s · %d × %s = %s" % [
					PropertyBusinessContract.date_text(row.get("world_date", {})),
					int(row.get("quantity", 0)),
					str(definition.get("label", row.get("product_definition_id", ""))),
					PropertyBusinessContract.naira(row.get("total_ngn", 0)),
				],
				11,
				TEXT_MUTED,
				card,
			)


## The owner and co-owner controls. Each is offered only to a role the server authorises for that
## action. The server checks again, and its refusal is shown.
func _add_owner_actions(card: VBoxContainer, profile: Dictionary, role: String) -> void:
	var business_id := str(profile.get("business_id", ""))
	_add_text("Actions for your role", 13, TEXT_DARK, card)
	if PropertyBusinessContract.can_perform("restock", role):
		_add_restock_form(card, profile)
	if PropertyBusinessContract.can_perform("pay_salary", role):
		_add_salary_form(card, profile)
	if PropertyBusinessContract.can_perform("transfer_funds", role):
		_add_transfer_form(card, profile)
	if PropertyBusinessContract.can_perform("contribute_capital", role):
		_add_money_form(card, business_id, "contribute_capital", "Contribute capital from your cash",
			int(_rules.get("maximum_capital_contribution_ngn", 0)))
	if PropertyBusinessContract.can_perform("withdraw", role):
		_add_money_form(card, business_id, "withdraw", "Withdraw to your cash",
			int(_rules.get("maximum_owner_withdrawal_ngn", 0)))
	if PropertyBusinessContract.can_perform("close", role):
		_add_close_form(card, profile)


func _add_restock_form(card: VBoxContainer, profile: Dictionary) -> void:
	var business_id := str(profile.get("business_id", ""))
	var row := HBoxContainer.new()
	card.add_child(row)
	var product_option := OptionButton.new()
	var products: Variant = profile.get("products", [])
	if products is Array:
		for product in products:
			if product is Dictionary:
				var definition_id := str(product.get("product_definition_id", ""))
				var index := product_option.item_count
				product_option.add_item(str(product.get("display_name", definition_id)), index)
				product_option.set_item_metadata(index, definition_id)
	row.add_child(product_option)
	var quantity := _line_edit("Units")
	row.add_child(quantity)
	var unit_cost := _line_edit("Unit cost (₦)")
	row.add_child(unit_cost)
	var restock := _button("Restock")
	restock.disabled = _tracker.has_pending() or product_option.item_count == 0
	restock.pressed.connect(func():
		var units := PropertyBusinessContract.parse_whole(quantity.text)
		var cost := PropertyBusinessContract.parse_whole(unit_cost.text)
		var max_units := int(_rules.get("maximum_stock_per_product", 0))
		if units < 1 or units > max_units or cost < 0:
			_notice = "Enter units from 1 to %d and a unit cost of 0 or more, as whole numbers." % max_units
			_render()
			return
		var definition_id := str(product_option.get_item_metadata(product_option.selected))
		_confirm_change("restock", {
			"business_id": business_id,
			"product_definition_id": definition_id,
			"quantity": units,
			"unit_cost_ngn": cost,
		}, "Restock %d units at %s each? The total %s is paid from the business balance." % [
			units, PropertyBusinessContract.naira(cost), PropertyBusinessContract.naira(units * cost),
		]))
	row.add_child(restock)


func _add_salary_form(card: VBoxContainer, profile: Dictionary) -> void:
	var business_id := str(profile.get("business_id", ""))
	var employees: Array = []
	for row in PropertyBusinessContract.active_owners(profile):
		if str(row.get("role", "")) == "employee":
			employees.append(row)
	if employees.is_empty():
		_add_text("No active employees to pay.", 11, TEXT_MUTED, card)
		return
	var row_box := HBoxContainer.new()
	card.add_child(row_box)
	var employee_option := OptionButton.new()
	for employee in employees:
		var index := employee_option.item_count
		employee_option.add_item(str(employee.get("character_id", "")), index)
		employee_option.set_item_metadata(index, str(employee.get("character_id", "")))
	row_box.add_child(employee_option)
	var amount := _line_edit("Amount (₦)")
	row_box.add_child(amount)
	var pay := _button("Pay salary")
	pay.disabled = _tracker.has_pending()
	pay.pressed.connect(func():
		var value := PropertyBusinessContract.parse_whole(amount.text)
		if value < 1:
			_notice = "Enter the salary as a whole number of naira, at least 1."
			_render()
			return
		var employee_id := str(employee_option.get_item_metadata(employee_option.selected))
		_confirm_change("pay_salary", {
			"business_id": business_id,
			"employee_character_id": employee_id,
			"amount_ngn": value,
		}, "Pay %s to employee %s from the business balance?" % [
			PropertyBusinessContract.naira(value), employee_id,
		]))
	row_box.add_child(pay)


func _add_transfer_form(card: VBoxContainer, profile: Dictionary) -> void:
	var business_id := str(profile.get("business_id", ""))
	var destinations: Array = []
	for other in _owned:
		if other is Dictionary and str(other.get("business_id", "")) != business_id:
			var other_role := PropertyBusinessContract.role_of(other, _character_id)
			if OWNER_ROLES.has(other_role):
				destinations.append(other)
	if destinations.is_empty():
		_add_text("Transfers go to another business you own or co-own. You have none.", 11, TEXT_MUTED,
			card)
		return
	var row := HBoxContainer.new()
	card.add_child(row)
	var destination_option := OptionButton.new()
	for destination in destinations:
		var index := destination_option.item_count
		destination_option.add_item(str(destination.get("name", "Business")), index)
		destination_option.set_item_metadata(index, str(destination.get("business_id", "")))
	row.add_child(destination_option)
	var amount := _line_edit("Amount (₦)")
	row.add_child(amount)
	var transfer := _button("Transfer funds")
	transfer.disabled = _tracker.has_pending()
	transfer.pressed.connect(func():
		var value := PropertyBusinessContract.parse_whole(amount.text)
		if value < 1:
			_notice = "Enter the amount as a whole number of naira, at least 1."
			_render()
			return
		var to_id := str(destination_option.get_item_metadata(destination_option.selected))
		_confirm_change("transfer_funds", {
			"business_id": business_id,
			"to_business_id": to_id,
			"amount_ngn": value,
		}, "Move %s from this business to %s?" % [
			PropertyBusinessContract.naira(value),
				destination_option.get_item_text(destination_option.selected),
		]))
	row.add_child(transfer)


func _add_money_form(card: VBoxContainer, business_id: String, action: String, title: String,
	ceiling: int) -> void:
	var row := HBoxContainer.new()
	card.add_child(row)
	var amount := _line_edit("%s (₦, up to %s)" % [title, PropertyBusinessContract.naira(ceiling)])
	row.add_child(amount)
	var submit := _button(PropertyBusinessContract.label_for(action))
	submit.disabled = _tracker.has_pending()
	submit.pressed.connect(func():
		var value := PropertyBusinessContract.parse_whole(amount.text)
		if value < 1 or value > ceiling:
			_notice = "Enter a whole number of naira from 1 to %s." % PropertyBusinessContract.naira(ceiling)
			_render()
			return
		var text_value := "Withdraw %s from the business into your cash?"
		if action == "contribute_capital":
			text_value = "Contribute %s from your cash as capital?"
		_confirm_change(action, {"business_id": business_id, "amount_ngn": value},
			text_value % PropertyBusinessContract.naira(value)))
	row.add_child(submit)


func _add_close_form(card: VBoxContainer, profile: Dictionary) -> void:
	var business_id := str(profile.get("business_id", ""))
	if str(profile.get("status", "")) == "closed":
		_add_text("This business is closed.", 11, TEXT_MUTED, card)
		return
	_add_text(
		"The server refuses to close a business while its balance is above zero. Closing is asked for "
		+ "here; the server's answer decides.",
		11,
		TEXT_MUTED,
		card,
	)
	var row := HBoxContainer.new()
	card.add_child(row)
	var reason := _line_edit("Reason (optional)")
	row.add_child(reason)
	var close := _button("Close business")
	close.disabled = _tracker.has_pending()
	close.pressed.connect(func():
		_confirm_change("close", {"business_id": business_id, "reason": reason.text.strip_edges()},
			"Ask the server to close %s now?" % str(profile.get("name", "this business"))))
	row.add_child(close)


# --- Event handlers ---


func _on_tab_pressed(tab_id: String) -> void:
	_tab = tab_id
	_render()
	if tab_id == "discover":
		_read("discover", {})


func _on_open_pressed(business_id: String) -> void:
	_selected_id = business_id
	_read("view", {"business_id": business_id})
	_render()


func _on_refresh_pressed() -> void:
	_read("discover", {})
	if not _selected_id.is_empty():
		_read("view", {"business_id": _selected_id})


func _on_close_details_pressed() -> void:
	_selected_id = ""
	_render()


func _on_confirm_pressed() -> void:
	var pending := _confirm
	_confirm = {}
	_change(str(pending.get("action", "")), pending.get("payload", {}))


func _on_confirm_cancelled() -> void:
	_confirm = {}
	_render()


func _retry_pending() -> void:
	var request_id := _tracker.retry()
	if request_id.is_empty():
		return
	_notice = "Retrying the same request. The server applies it at most once."
	_render()
	business_action_requested.emit(_tracker.action(), _tracker.payload(), request_id)


func _discard_pending() -> void:
	_tracker.resolve()
	_notice = "Discarded. If the first attempt was saved, the records show it."
	_render()


# --- Helpers ---


func _profile_for(business_id: String) -> Dictionary:
	for profile in _owned:
		if profile is Dictionary and str(profile.get("business_id", "")) == business_id:
			return profile
	var found: Variant = _details.get(business_id, {})
	return found if found is Dictionary else {}


func _input_has_focus() -> bool:
	for control in _inputs:
		if is_instance_valid(control) and control.has_focus():
			return true
	return false


func _line_edit(placeholder: String) -> LineEdit:
	var edit := LineEdit.new()
	edit.placeholder_text = placeholder
	edit.custom_minimum_size = Vector2(150.0, 34.0)
	_inputs.append(edit)
	return edit


func _button(label: String) -> Button:
	var button := Button.new()
	button.text = label
	button.custom_minimum_size = Vector2(120.0, 34.0)
	return button


func _card() -> VBoxContainer:
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 6)
	box.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var style := StyleBoxFlat.new()
	style.bg_color = LIGHT_GREEN
	style.corner_radius_top_left = 6
	style.corner_radius_top_right = 6
	style.corner_radius_bottom_left = 6
	style.corner_radius_bottom_right = 6
	style.content_margin_left = 10.0
	style.content_margin_right = 10.0
	style.content_margin_top = 8.0
	style.content_margin_bottom = 8.0
	var panel := PanelContainer.new()
	panel.add_theme_stylebox_override("panel", style)
	panel.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	panel.add_child(box)
	add_child(panel)
	return box


func _add_text(text_value: String, size: int, color: Color, parent: Node = null) -> Label:
	var label := Label.new()
	label.text = text_value
	label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	label.add_theme_font_size_override("font_size", size)
	label.add_theme_color_override("font_color", color)
	label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var target: Node = self if parent == null else parent
	target.add_child(label)
	return label
