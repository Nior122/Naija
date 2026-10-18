class_name HousingPanel
extends VBoxContainer

## Housing screen (Stage 41). It shows the market, the player's own properties and rentals, and a
## detail view for one property. Every change is sent to the server as property.action. The screen
## changes state only from the server's reply (property.result) or from a character snapshot. A
## money-moving action asks for confirmation first.

signal housing_action_requested(action: String, payload: Dictionary, request_id: String)

const TEXT_DARK := Color("#27352b")
const TEXT_MUTED := Color("#657466")
const GREEN := Color("#39734a")
const WARNING := Color("#8a3b2a")
const LIGHT_GREEN := Color("#e6eee2")
const TAB_IDS: Array[String] = ["market", "mine", "rentals"]
const TAB_LABELS: Dictionary = {"market": "Market", "mine": "My properties",
	"rentals": "My rentals"}
const LISTING_TYPES: Array[String] = ["", "sale", "rent"]
const LISTING_LABELS: Array[String] = ["Any listing", "For sale", "To rent"]

var _online := false
var _character_id := ""
var _money := 0
var _tracker := ServerRequestTracker.new()
var _tab := "market"
var _notice := ""
var _market: Dictionary = {}
var _properties: Array = []
var _rentals: Array = []
var _details: Dictionary = {}
var _selected_id := ""
var _confirm: Dictionary = {}
var _listing_filter := 0
var _location_filter := ""
var _inputs: Array = []
var _location_option: OptionButton


## Sets the signed-in character, their cash, and whether the shared world is connected. Opening the
## screen loads the market.
func configure(character_id: String, money: int, is_online: bool) -> void:
	_character_id = character_id
	_money = money
	_online = is_online
	_render()
	if _online:
		_search_market()


## The UI layer owns the tracker, so a request keeps its state while the panel is closed.
func bind_tracker(tracker: ServerRequestTracker) -> void:
	_tracker = tracker
	_render()


## Stores the character's own properties and rentals from a character snapshot. The screen is not
## rebuilt while the player is typing in one of its fields, so their entry is not lost.
func show_profiles(properties: Array, rentals: Array, money: int) -> void:
	_properties = properties.duplicate(true)
	_rentals = rentals.duplicate(true)
	_money = money
	if _input_has_focus():
		return
	_render()


## The UI layer updates the tracker first and passes answered = true when the reply answered the
## pending request. A reply to a pending request refreshes the open property, so its records show
## the server's state.
func apply_server_response(message: Dictionary, answered: bool) -> void:
	var response_type := str(message.get("type", ""))
	if response_type != "property.result" and response_type != "property.error":
		return
	var action := str(message.get("action", ""))
	if response_type == "property.error":
		_notice = str(message.get("message", "The server refused this housing request."))
		_render()
		return
	_notice = str(message.get("message", "Done."))
	var data: Variant = message.get("data", {})
	if data is Dictionary:
		_apply_result(action, data)
	if answered and not _selected_id.is_empty():
		_read("view", {"property_id": _selected_id})
	_render()


## Shows a notice from the UI layer, such as a lost connection, a timeout, or a request that could
## not be sent.
func show_notice_text(text_value: String) -> void:
	_notice = text_value
	_render()


func _apply_result(action: String, data: Dictionary) -> void:
	match action:
		"market":
			var market: Variant = data.get("market", {})
			if market is Dictionary:
				_market = market.duplicate(true)
		"view":
			var profile: Variant = data.get("property_profile", {})
			if profile is Dictionary and not str(profile.get("property_id", "")).is_empty():
				_details[str(profile.get("property_id", ""))] = profile.duplicate(true)
		"my_properties":
			var properties: Variant = data.get("properties", [])
			if properties is Array:
				_properties = properties.duplicate(true)
		"my_rentals":
			var rentals: Variant = data.get("rentals", [])
			if rentals is Array:
				_rentals = rentals.duplicate(true)
		"purchase":
			_tab = "mine"
		"rent":
			_tab = "rentals"
		_:
			pass


# --- Requests ---


## A read-only request. It is not tracked as pending, so several can be in flight.
func _read(action: String, payload: Dictionary) -> void:
	if not _online:
		return
	housing_action_requested.emit(action, payload.duplicate(true), "")


## A changing request. Only one may be pending; the buttons that send one are disabled while it
## waits.
func _change(action: String, payload: Dictionary) -> void:
	if not _online:
		_notice = "Housing changes need the connected shared world."
		_render()
		return
	var request_id := _tracker.begin(action, payload)
	if request_id.is_empty():
		_notice = "Another housing request is still waiting. Wait for the server to answer it first."
		_render()
		return
	_notice = "Sent to the shared property service. Waiting for the server to confirm…"
	_render()
	housing_action_requested.emit(action, payload.duplicate(true), request_id)


## Asks the player to confirm a money-moving action before it is sent.
func _confirm_change(action: String, payload: Dictionary, label: String) -> void:
	_confirm = {"action": action, "payload": payload.duplicate(true), "label": label}
	_render()


func _search_market() -> void:
	var filters: Dictionary = {}
	var listing_type: String = LISTING_TYPES[_listing_filter]
	if not listing_type.is_empty():
		filters["listing_type"] = listing_type
	if not _location_filter.is_empty():
		filters["location_id"] = _location_filter
	_read("market", {"filters": filters})


# --- Rendering ---


func _render() -> void:
	for child in get_children():
		child.queue_free()
	_inputs.clear()
	_location_option = null
	if not _online:
		_add_text(
			"Housing is available in the connected shared world only. Prices, ownership and rent are "
			+ "recorded by the server, so this screen shows no local placeholder.",
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
	match _tab:
		"market":
			_add_market()
		"mine":
			_add_my_properties()
		"rentals":
			_add_my_rentals()


func _add_pending_box() -> void:
	if not _tracker.has_pending():
		return
	if _tracker.is_waiting():
		_add_text("A change is waiting for the server. Other changes are paused until it is answered.",
			12, TEXT_MUTED)
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
		+ "undo a "
		+ "change that was already saved; the records show the current state.",
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


func _add_market() -> void:
	var filter_row := HBoxContainer.new()
	add_child(filter_row)
	var listing_option := OptionButton.new()
	for index in range(LISTING_LABELS.size()):
		listing_option.add_item(LISTING_LABELS[index], index)
	listing_option.select(_listing_filter)
	listing_option.item_selected.connect(func(index: int): _listing_filter = index)
	filter_row.add_child(listing_option)
	_location_option = OptionButton.new()
	_location_option.add_item("Any place", 0)
	_location_option.set_item_metadata(0, "")
	var locations: Variant = _market.get("catalog_locations", [])
	if locations is Array:
		for location in locations:
			if location is Dictionary:
				var index := _location_option.item_count
				_location_option.add_item(str(location.get("label", location.get("id", ""))), index)
				_location_option.set_item_metadata(index, str(location.get("id", "")))
	_select_location_option()
	filter_row.add_child(_location_option)
	var search := _button("Search")
	search.pressed.connect(_on_search_pressed)
	filter_row.add_child(search)

	var listings: Variant = _market.get("listings", [])
	if not listings is Array or listings.is_empty():
		_add_text(
			"No listings match this search yet. Search again later, or check My properties.",
			12,
			TEXT_MUTED,
		)
		return
	_add_text(
		"%d for sale · %d to rent" % [int(_market.get("total_for_sale", 0)),
			int(_market.get("total_for_rent", 0))],
		11,
		TEXT_MUTED,
	)
	for listing in listings:
		if listing is Dictionary:
			_add_listing_row(listing)


func _add_listing_row(listing: Dictionary) -> void:
	var card := _card()
	var property_id := str(listing.get("property_id", ""))
	_add_text(str(listing.get("name", "Property")), 14, TEXT_DARK, card)
	var type_text := str(listing.get("location_label", listing.get("location_id", "")))
	_add_text(
		"%s · %s · %d bed · %d bath · %d m²" % [
			type_text,
			PropertyBusinessContract.label_for(str(listing.get("condition", ""))),
			int(listing.get("bedrooms", 0)),
			int(listing.get("bathrooms", 0)),
			int(listing.get("size_sqm", 0)),
		],
		11,
		TEXT_MUTED,
		card,
	)
	var listing_type := str(listing.get("listing_type", ""))
	var seller_is_me := str(listing.get("owner_id", "")) == _character_id
	if listing_type == "sale":
		_add_text("For sale: %s" % PropertyBusinessContract.naira(listing.get("asking_price_ngn", 0)),
			13, GREEN, card)
	elif listing_type == "rent":
		_add_text(
			"To rent: %s per %s · deposit %s" % [
				PropertyBusinessContract.naira(listing.get("rent_price_ngn", 0)),
				PropertyBusinessContract.label_for(str(listing.get("rent_period", ""))).to_lower(),
				PropertyBusinessContract.naira(listing.get("deposit_ngn", 0)),
			],
			13,
			GREEN,
			card,
		)
	var row := HBoxContainer.new()
	card.add_child(row)
	var details := _button("Details")
	details.pressed.connect(_on_details_pressed.bind(property_id))
	row.add_child(details)
	if bool(listing.get("available", false)) and not seller_is_me:
		var listing_id := str(listing.get("listing_id", ""))
		if listing_type == "sale":
			var buy := _button("Buy")
			buy.disabled = _tracker.has_pending()
			buy.pressed.connect(_on_buy_pressed.bind(listing_id, str(listing.get("name", "this property")),
				int(listing.get("asking_price_ngn", 0))))
			row.add_child(buy)
		elif listing_type == "rent":
			var rent := _button("Rent")
			rent.disabled = _tracker.has_pending()
			rent.pressed.connect(_on_rent_pressed.bind(listing_id, str(listing.get("name", "this property")),
				int(listing.get("rent_price_ngn", 0)), str(listing.get("rent_period", ""))))
			row.add_child(rent)


func _add_my_properties() -> void:
	if _properties.is_empty():
		_add_text(
			"You do not own any property yet. Browse the market to buy a property or rent one.",
			12,
			TEXT_MUTED,
		)
		return
	for profile in _properties:
		if not profile is Dictionary:
			continue
		var card := _card()
		_add_text(str(profile.get("name", "Property")), 14, TEXT_DARK, card)
		var listing: Variant = profile.get("active_listing", null)
		var rental: Variant = profile.get("active_rental", null)
		var status := "Not listed"
		if listing is Dictionary:
			status = "Listed %s" % (
				"for sale" if str(listing.get("listing_type", "")) == "sale" else "to rent"
			)
		if rental is Dictionary:
			status = "Rented to %s" % (
				"you" if str(rental.get("tenant_id", "")) == _character_id else "a tenant"
			)
		_add_text(
			"Condition: %s · %s" % [
				PropertyBusinessContract.label_for(str(profile.get("condition", ""))),
				status,
			],
			11,
			TEXT_MUTED,
			card,
		)
		var manage := _button("Manage")
		manage.pressed.connect(_on_manage_pressed.bind(str(profile.get("property_id", ""))))
		card.add_child(manage)


func _add_my_rentals() -> void:
	if _rentals.is_empty():
		_add_text("You have no rental agreements. Rent a property from the market to start one.", 12,
			TEXT_MUTED)
		return
	for agreement in _rentals:
		if not agreement is Dictionary:
			continue
		var card := _card()
		var property_id := str(agreement.get("property_id", ""))
		var status := str(agreement.get("status", ""))
		_add_text(str(agreement.get("property_name", "Property")), 14, TEXT_DARK, card)
		_add_text(
			"%s per %s · deposit %s · paid so far %s · %s" % [
				PropertyBusinessContract.naira(agreement.get("rent_ngn", 0)),
				PropertyBusinessContract.label_for(str(agreement.get("rent_period", ""))).to_lower(),
				PropertyBusinessContract.naira(agreement.get("deposit_ngn", 0)),
				PropertyBusinessContract.naira(agreement.get("total_paid_ngn", 0)),
				PropertyBusinessContract.label_for(status).to_lower(),
			],
			11,
			TEXT_MUTED,
			card,
		)
		_add_text(_payment_status_text(property_id), 11, TEXT_DARK, card)
		var row := HBoxContainer.new()
		card.add_child(row)
		var details := _button("Details & due date")
		details.pressed.connect(_on_details_pressed.bind(property_id))
		row.add_child(details)
		if status == "active":
			var pay := _button("Pay rent")
			pay.disabled = _tracker.has_pending()
			pay.pressed.connect(_on_pay_rent_pressed.bind(
				str(agreement.get("agreement_id", "")),
				str(agreement.get("property_name", "this property")),
				int(agreement.get("rent_ngn", 0)),
			))
			row.add_child(pay)
			_add_end_rental_row(row, str(agreement.get("agreement_id", "")),
				str(agreement.get("property_name", "this property")))


## The paid-through date comes from the property's own record (view), not from the rental list,
## which omits it.
func _payment_status_text(property_id: String) -> String:
	var profile := _profile_for(property_id)
	var rental: Variant = profile.get("active_rental", null)
	if not rental is Dictionary:
		return "Payment status: open Details to load the due date."
	if rental.get("paid_through_world_date", null) is Dictionary:
		return "Covered through %s; the next period is due from that day." % \
			PropertyBusinessContract.date_text(
			rental.get("paid_through_world_date", {})
		)
	return "No period is recorded as paid yet; rent is due from the start date %s." % \
		PropertyBusinessContract.date_text(
		rental.get("start_world_date", {})
	)


func _add_detail() -> void:
	var profile := _profile_for(_selected_id)
	var card := _card()
	if profile.is_empty():
		_add_text("Loading this property from the server…", 12, TEXT_MUTED, card)
	else:
		_add_property_profile(card, profile)
	var close := _button("Close details")
	close.pressed.connect(_on_close_details_pressed)
	card.add_child(close)


func _add_property_profile(card: VBoxContainer, profile: Dictionary) -> void:
	var property_id := str(profile.get("property_id", ""))
	_add_text(str(profile.get("name", "Property")), 15, TEXT_DARK, card)
	_add_text(str(profile.get("description", "")), 12, TEXT_MUTED, card)
	_add_text(
		"%s · %d bed · %d bath · %d m² · up to %d occupants" % [
			PropertyBusinessContract.label_for(str(profile.get("location_id", ""))),
			int(profile.get("bedrooms", 0)),
			int(profile.get("bathrooms", 0)),
			int(profile.get("size_sqm", 0)),
			int(profile.get("max_occupants", 0)),
		],
		12,
		TEXT_DARK,
		card,
	)
	_add_text(
		"Condition: %s · Development: %s" % [
			PropertyBusinessContract.label_for(str(profile.get("condition", ""))),
			PropertyBusinessContract.label_for(str(profile.get("development_status", ""))),
		],
		12,
		TEXT_DARK,
		card,
	)
	var amenities: Variant = profile.get("amenities", [])
	if amenities is Array and not amenities.is_empty():
		_add_text("Amenities: %s" % ", ".join(PackedStringArray(amenities)), 12, TEXT_MUTED, card)

	var ownership: Variant = profile.get("ownership", {})
	var owner_id := ""
	var owner_kind := ""
	if ownership is Dictionary:
		owner_id = str(ownership.get("owner_id", ""))
		owner_kind = str(ownership.get("owner_kind", ""))
	var i_own := owner_kind == "player" and owner_id == _character_id
	_add_text(
		"Owner: %s" % ("you" if i_own else "%s (%s)" % [owner_id, owner_kind]),
		12,
		TEXT_DARK,
		card,
	)

	var listing: Variant = profile.get("active_listing", null)
	if listing is Dictionary:
		var listing_type := str(listing.get("listing_type", ""))
		if listing_type == "sale":
			_add_text(
				"Listed for sale at %s" % PropertyBusinessContract.naira(listing.get("asking_price_ngn", 0)),
				12, GREEN, card)
		elif listing_type == "rent":
			_add_text("Listed to rent at %s per %s" % [
				PropertyBusinessContract.naira(listing.get("rent_price_ngn", 0)),
				PropertyBusinessContract.label_for(str(listing.get("rent_period", ""))).to_lower(),
			], 12, GREEN, card)

	var rental: Variant = profile.get("active_rental", null)
	if rental is Dictionary:
		_add_rental_detail(card, rental)

	_add_furnishing(card, profile, i_own)
	_add_actions(card, profile, i_own)
	_add_events(card, profile)


func _add_rental_detail(card: VBoxContainer, rental: Dictionary) -> void:
	var tenant_is_me := str(rental.get("tenant_id", "")) == _character_id
	_add_text(
		"Rental: %s · %s per %s · deposit %s · %s" % [
			"you are the tenant" if tenant_is_me else "tenant %s" % str(rental.get("tenant_id", "")),
			PropertyBusinessContract.naira(rental.get("rent_ngn", 0)),
			PropertyBusinessContract.label_for(str(rental.get("rent_period", ""))).to_lower(),
			PropertyBusinessContract.naira(rental.get("deposit_ngn", 0)),
			PropertyBusinessContract.label_for(str(rental.get("status", ""))).to_lower(),
		],
		12,
		TEXT_DARK,
		card,
	)
	_add_text(
		"Paid through %s · paid so far %s · last payment %s" % [
			PropertyBusinessContract.date_text(rental.get("paid_through_world_date", {})),
			PropertyBusinessContract.naira(rental.get("total_paid_ngn", 0)),
			PropertyBusinessContract.date_text(rental.get("last_payment_world_date", {})),
		],
		12,
		TEXT_MUTED,
		card,
	)


func _add_furnishing(card: VBoxContainer, profile: Dictionary, i_own: bool) -> void:
	var rows: Variant = profile.get("furnishing", [])
	_add_text("Furnishing", 13, TEXT_DARK, card)
	if not rows is Array or rows.is_empty():
		_add_text("No furniture placed yet.", 11, TEXT_MUTED, card)
		return
	for row in rows:
		if not row is Dictionary:
			continue
		var line := HBoxContainer.new()
		card.add_child(line)
		_add_text(
			"%s × %d" % [
				PropertyBusinessContract.furniture_label(str(row.get("furniture_definition_id", ""))),
				int(row.get("quantity", 0)),
			],
			12,
			TEXT_DARK,
			line,
		)
		if i_own:
			var remove := _button("Remove")
			remove.disabled = _tracker.has_pending()
			remove.pressed.connect(_on_remove_furnishing_pressed.bind(
				str(profile.get("property_id", "")), str(row.get("furnishing_id", "")),
			))
			line.add_child(remove)


## The owner's controls. Each one is offered only to the player who owns the property; the server
## checks it again.
func _add_actions(card: VBoxContainer, profile: Dictionary, i_own: bool) -> void:
	var property_id := str(profile.get("property_id", ""))
	var listing: Variant = profile.get("active_listing", null)
	var rental: Variant = profile.get("active_rental", null)
	if i_own:
		_add_text("Owner actions", 13, TEXT_DARK, card)
		if not listing is Dictionary:
			_add_sale_listing_form(card, property_id)
			_add_rent_listing_form(card, property_id)
		_add_maintenance_form(card, property_id, str(profile.get("name", "this property")))
		_add_furnish_form(card, property_id)
		_add_transfer_form(card, property_id)
	elif listing is Dictionary and bool(listing.get("available", false)):
		var listing_id := str(listing.get("listing_id", ""))
		var name_text := str(profile.get("name", "this property"))
		if str(listing.get("listing_type", "")) == "sale":
			var buy := _button("Buy this property")
			buy.disabled = _tracker.has_pending()
			buy.pressed.connect(_on_buy_pressed.bind(
				listing_id, name_text, int(listing.get("asking_price_ngn", 0))
			))
			card.add_child(buy)
		elif str(listing.get("listing_type", "")) == "rent":
			var rent := _button("Rent this property")
			rent.disabled = _tracker.has_pending()
			rent.pressed.connect(_on_rent_pressed.bind(
				listing_id, name_text, int(listing.get("rent_price_ngn", 0)),
				str(listing.get("rent_period", ""))
			))
			card.add_child(rent)
	if rental is Dictionary and str(rental.get("status", "")) == "active":
		var agreement_id := str(rental.get("agreement_id", ""))
		var name_text := str(profile.get("name", "this property"))
		if str(rental.get("tenant_id", "")) == _character_id:
			var pay := _button("Pay rent")
			pay.disabled = _tracker.has_pending()
			pay.pressed.connect(_on_pay_rent_pressed.bind(
				agreement_id, name_text, int(rental.get("rent_ngn", 0))
			))
			card.add_child(pay)
		if str(rental.get("tenant_id", "")) == _character_id or str(rental.get("landlord_id",
			"")) == _character_id:
			_add_end_rental_row(card, agreement_id, name_text)


## The end-of-rental control. The reason is optional and is sent exactly as typed.
func _add_end_rental_row(parent: Node, agreement_id: String, name_text: String) -> void:
	var reason := _line_edit("Reason (optional)")
	parent.add_child(reason)
	var end := _button("End rental")
	end.disabled = _tracker.has_pending()
	end.pressed.connect(func(): _on_end_rental_pressed(agreement_id, name_text, reason.text))
	parent.add_child(end)


func _add_sale_listing_form(card: VBoxContainer, property_id: String) -> void:
	var row := HBoxContainer.new()
	card.add_child(row)
	var price := _line_edit("Asking price (₦)")
	row.add_child(price)
	var list := _button("List for sale")
	list.disabled = _tracker.has_pending()
	list.pressed.connect(func():
		var value := PropertyBusinessContract.parse_whole(price.text)
		if value < 1:
			_notice = "Enter the asking price as a whole number of naira."
			_render()
			return
		_change("list_for_sale", {"property_id": property_id, "asking_price_ngn": value}))
	row.add_child(list)


func _add_rent_listing_form(card: VBoxContainer, property_id: String) -> void:
	var row := HBoxContainer.new()
	card.add_child(row)
	var rent_price := _line_edit("Rent (₦)")
	row.add_child(rent_price)
	var period := OptionButton.new()
	for index in range(PropertyBusinessContract.RENT_PERIODS.size()):
		var period_id := PropertyBusinessContract.RENT_PERIODS[index]
		period.add_item(PropertyBusinessContract.label_for(period_id), index)
		period.set_item_metadata(index, period_id)
	row.add_child(period)
	var deposit := _line_edit("Deposit (₦)")
	row.add_child(deposit)
	var list := _button("List to rent")
	list.disabled = _tracker.has_pending()
	list.pressed.connect(func():
		var rent_value := PropertyBusinessContract.parse_whole(rent_price.text)
		var deposit_value := PropertyBusinessContract.parse_whole(deposit.text)
		if rent_value < 1 or deposit_value < 0:
			_notice = "Enter the rent as a whole number of naira, and the deposit as a number (0 or more)."
			_render()
			return
		var chosen_period := str(period.get_item_metadata(period.selected))
		_change("list_for_rent", {
			"property_id": property_id,
			"rent_price_ngn": rent_value,
			"rent_period": chosen_period,
			"deposit_ngn": deposit_value,
		}))
	row.add_child(list)


func _add_maintenance_form(card: VBoxContainer, property_id: String, name_text: String) -> void:
	var row := HBoxContainer.new()
	card.add_child(row)
	var description := _line_edit("Work done")
	row.add_child(description)
	var cost := _line_edit("Cost (₦)")
	row.add_child(cost)
	var condition := OptionButton.new()
	for index in range(PropertyBusinessContract.PROPERTY_CONDITIONS.size()):
		var condition_id := PropertyBusinessContract.PROPERTY_CONDITIONS[index]
		condition.add_item(PropertyBusinessContract.label_for(condition_id), index)
		condition.set_item_metadata(index, condition_id)
	row.add_child(condition)
	var record := _button("Record maintenance")
	record.disabled = _tracker.has_pending()
	record.pressed.connect(func():
		var cost_value := PropertyBusinessContract.parse_whole(cost.text)
		var text_value := description.text.strip_edges()
		if text_value.is_empty() or cost_value < 0:
			_notice = "Describe the work and enter its cost as a whole number of naira."
			_render()
			return
		_confirm_change("maintain", {
			"property_id": property_id,
			"description": text_value,
			"cost_ngn": cost_value,
			"condition": str(condition.get_item_metadata(condition.selected)),
		}, "Record this maintenance for %s? The cost (%s) is taken from your cash." % [
			name_text, PropertyBusinessContract.naira(cost_value),
		]))
	row.add_child(record)


func _add_furnish_form(card: VBoxContainer, property_id: String) -> void:
	var row := HBoxContainer.new()
	card.add_child(row)
	var furniture := OptionButton.new()
	var furniture_rows := PropertyBusinessContract.furniture_definitions()
	for index in range(furniture_rows.size()):
		var item: Variant = furniture_rows[index]
		if not item is Dictionary:
			continue
		furniture.add_item("%s (%s)" % [
			str(item.get("label", "")), PropertyBusinessContract.naira(item.get("price_ngn", 0)),
		], index)
		furniture.set_item_metadata(index, item)
	row.add_child(furniture)
	var quantity := _line_edit("Quantity (1–10)")
	row.add_child(quantity)
	var buy := _button("Furnish")
	buy.disabled = _tracker.has_pending()
	buy.pressed.connect(func():
		if furniture.item_count == 0:
			return
		var count := PropertyBusinessContract.parse_whole(quantity.text)
		if count < 1 or count > 10:
			_notice = "Enter a quantity from 1 to 10."
			_render()
			return
		var chosen: Variant = furniture.get_item_metadata(furniture.selected)
		var furniture_id := str((chosen as Dictionary).get("id", ""))
		var total := int((chosen as Dictionary).get("price_ngn", 0)) * count
		_confirm_change("furnish", {
			"property_id": property_id, "furniture_id": furniture_id, "quantity": count,
		}, "Buy %d × %s for %s from your cash?" % [
			count, str((chosen as Dictionary).get("label", furniture_id)),
				PropertyBusinessContract.naira(total),
		]))
	row.add_child(buy)


func _add_transfer_form(card: VBoxContainer, property_id: String) -> void:
	_add_text(
		"Transfer gives this property to another character. Enter their character ID exactly; "
		+ "the server refuses an "
		+ "unknown ID. A transfer cannot be undone from the game.",
		11,
		TEXT_MUTED,
		card,
	)
	var row := HBoxContainer.new()
	card.add_child(row)
	var recipient := _line_edit("Recipient character ID")
	row.add_child(recipient)
	var transfer := _button("Transfer")
	transfer.disabled = _tracker.has_pending()
	transfer.pressed.connect(func():
		var target := recipient.text.strip_edges()
		if target.is_empty():
			_notice = "Enter the recipient's character ID."
			_render()
			return
		_confirm_change("transfer", {"property_id": property_id, "to_character_id": target},
			"Transfer this property to character %s?" % target))
	row.add_child(transfer)


func _add_events(card: VBoxContainer, profile: Dictionary) -> void:
	var events: Variant = profile.get("recent_events", [])
	if not events is Array or events.is_empty():
		return
	_add_text("Recent events", 13, TEXT_DARK, card)
	for event in events:
		if event is Dictionary:
			_add_text(
				"%s — %s" % [PropertyBusinessContract.date_text(event.get("world_date", {})),
					str(event.get("summary", ""))],
				11,
				TEXT_MUTED,
				card,
			)


# --- Event handlers ---


func _on_tab_pressed(tab_id: String) -> void:
	_tab = tab_id
	_render()
	if tab_id == "market":
		_search_market()
	elif tab_id == "mine" and _online:
		_read("my_properties", {})
	elif tab_id == "rentals" and _online:
		_read("my_rentals", {})


func _on_search_pressed() -> void:
	_location_filter = _selected_location_id()
	_search_market()


func _on_details_pressed(property_id: String) -> void:
	_selected_id = property_id
	_read("view", {"property_id": property_id})
	_render()


func _on_manage_pressed(property_id: String) -> void:
	_selected_id = property_id
	_read("view", {"property_id": property_id})
	_render()


func _on_close_details_pressed() -> void:
	_selected_id = ""
	_render()


func _on_buy_pressed(listing_id: String, name_text: String, price: int) -> void:
	_confirm_change("purchase", {"listing_id": listing_id},
		"Buy %s for %s? The price comes from your own cash." % [
		name_text, PropertyBusinessContract.naira(price),
	])


func _on_rent_pressed(listing_id: String, name_text: String, rent: int, period: String) -> void:
	_confirm_change("rent", {"listing_id": listing_id},
		"Rent %s at %s per %s? The first payment and the deposit come from your cash." % [
		name_text, PropertyBusinessContract.naira(rent),
			PropertyBusinessContract.label_for(period).to_lower(),
	])


func _on_pay_rent_pressed(agreement_id: String, name_text: String, rent: int) -> void:
	_confirm_change("pay_rent", {"agreement_id": agreement_id},
		"Pay %s rent for %s from your cash?" % [
		PropertyBusinessContract.naira(rent), name_text,
	])


func _on_end_rental_pressed(agreement_id: String, name_text: String, reason_text: String) -> void:
	_confirm_change("terminate_rental", {"agreement_id": agreement_id,
		"reason": reason_text.strip_edges()},
		"End the rental of %s now? This action asks the server to end the agreement." % name_text)


func _on_remove_furnishing_pressed(property_id: String, furnishing_id: String) -> void:
	_change("remove_furnishing", {"property_id": property_id, "furnishing_id": furnishing_id})


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
	housing_action_requested.emit(_tracker.action(), _tracker.payload(), request_id)


func _discard_pending() -> void:
	_tracker.resolve()
	_notice = "Discarded. If the first attempt was saved, the records show it."
	_render()


# --- Helpers ---


func _profile_for(property_id: String) -> Dictionary:
	for profile in _properties:
		if profile is Dictionary and str(profile.get("property_id", "")) == property_id:
			return profile
	var found: Variant = _details.get(property_id, {})
	return found if found is Dictionary else {}


func _selected_location_id() -> String:
	if not is_instance_valid(_location_option):
		return ""
	var metadata: Variant = _location_option.get_item_metadata(_location_option.selected)
	return str(metadata) if metadata != null else ""


func _select_location_option() -> void:
	if not is_instance_valid(_location_option):
		return
	for index in range(_location_option.item_count):
		if str(_location_option.get_item_metadata(index)) == _location_filter:
			_location_option.select(index)
			return


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
