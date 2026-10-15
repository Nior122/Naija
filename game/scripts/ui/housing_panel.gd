class_name HousingPanel
extends VBoxContainer

signal property_action_requested(action: String, payload: Dictionary)

const CATALOG_PATH := "res://data/properties/catalog.json"
const TEXT_DARK := Color("#27352b")
const TEXT_MUTED := Color("#657466")
const GREEN := Color("#39734a")
const WARN_COLOR := Color("#8a4c36")
const LIGHT_GREEN := Color("#e6eee2")
const RENT_PERIODS: Array[String] = ["yearly", "half_yearly", "quarterly", "monthly"]
const CONDITIONS: Array[String] = ["excellent", "good", "fair", "poor", "requires_repair"]
const READ_ONLY_ACTIONS: Array[String] = ["market", "view", "my_properties", "my_rentals"]

var _catalog: Dictionary = {}
var _character: Dictionary = {}
var _world_date: Dictionary = {}
var _nearby_players: Array = []
var _owned_properties: Array = []
var _rentals: Array = []
var _market_listings: Array = []
var _known_profiles: Dictionary = {}
var _inspected_property: Dictionary = {}
var _selected_property_id := ""
var _active_tab := "market"
var _online := false
var _busy := false
var _notice := ""
var _notice_is_error := false
var _preserved_notice := ""
var _pending_reads: Array[Dictionary] = []
var _form: Dictionary = {
	"filter_min_bedrooms": "0",
	"sale_price": "5000000",
	"rent_price": "300000",
	"rent_period": "yearly",
	"rent_deposit": "50000",
	"maint_condition": "good",
	"maint_cost": "25000",
	"maint_desc": "Routine structural maintenance",
	"furnish_id": "furn:bed-single",
	"furnish_qty": "1",
	"terminate_reason": "Mutual termination",
}


func _init() -> void:
	_load_catalog()


func configure(
	character: Dictionary,
	property_profiles: Array,
	rental_agreements: Array,
	is_online: bool,
	world_date: Dictionary,
	nearby_players: Array = []
) -> void:
	_character = character.duplicate(true)
	_world_date = world_date.duplicate(true)
	_nearby_players = nearby_players.duplicate(true)
	_online = is_online
	_ingest_owned_and_rentals(property_profiles, rental_agreements)
	_render()


func request_initial_data() -> void:
	if _online:
		_pending_reads = [
			{"action": "my_properties", "payload": {}},
			{"action": "my_rentals", "payload": {}},
		]
		_emit_action("market", {"filters": _build_market_filters()})


func apply_server_response(message: Dictionary) -> void:
	_busy = false
	var response_type := str(message.get("type", ""))
	var action := str(message.get("action", ""))
	if response_type == "property.error":
		_pending_reads.clear()
		_preserved_notice = ""
		var code := str(message.get("code", "property_error"))
		var err_text := str(message.get("message", "The server rejected this property request."))
		_notice = "%s (%s)" % [err_text, code]
		_notice_is_error = true
		_render()
		return
	if response_type != "property.result":
		_render()
		return
	var data: Variant = message.get("data", {})
	if not data is Dictionary:
		_notice = "The server response did not include property data."
		_notice_is_error = true
		_render()
		return
	_apply_result_data(action, data, str(message.get("message", "Property records updated.")))
	if not _pending_reads.is_empty() and _online:
		var next_read: Dictionary = _pending_reads.pop_front()
		var next_act := str(next_read.get("action", "market"))
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


func update_records(property_profiles: Array, rental_agreements: Array) -> void:
	_ingest_owned_and_rentals(property_profiles, rental_agreements)
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
	if not FileAccess.file_exists(CATALOG_PATH):
		return
	var parsed: Variant = JSON.parse_string(FileAccess.get_file_as_string(CATALOG_PATH))
	if parsed is Dictionary:
		_catalog = parsed


func _ingest_owned_and_rentals(property_profiles: Array, rental_agreements: Array) -> void:
	_owned_properties = property_profiles.duplicate(true)
	_rentals = rental_agreements.duplicate(true)
	for entry in _owned_properties:
		if entry is Dictionary:
			var prop_id := _prop_id(entry)
			if not prop_id.is_empty():
				_known_profiles[prop_id] = entry.duplicate(true)
				if prop_id == _selected_property_id:
					_inspected_property = entry.duplicate(true)


func _apply_result_data(action: String, data: Dictionary, server_message: String) -> void:
	if not READ_ONLY_ACTIONS.has(action):
		_preserved_notice = server_message
		_notice = server_message
		_notice_is_error = false
	elif _preserved_notice.is_empty():
		_notice = server_message
		_notice_is_error = false

	match action:
		"market":
			var market: Variant = data.get("market", {})
			if market is Dictionary and market.get("listings", []) is Array:
				_market_listings = (market.get("listings", []) as Array).duplicate(true)
		"my_properties":
			var props: Variant = data.get("properties", [])
			if props is Array:
				_ingest_owned_and_rentals(props, _rentals)
		"my_rentals":
			var rents: Variant = data.get("rentals", [])
			if rents is Array:
				_rentals = rents.duplicate(true)
		"view":
			var profile: Variant = data.get("property_profile", {})
			if profile is Dictionary and not profile.is_empty():
				_inspected_property = profile.duplicate(true)
				_selected_property_id = _prop_id(_inspected_property)
				_known_profiles[_selected_property_id] = _inspected_property.duplicate(true)
		_:
			var prop_rec: Variant = data.get("property", {})
			if prop_rec is Dictionary and not str(prop_rec.get("property_id", "")).is_empty():
				_selected_property_id = str(prop_rec.get("property_id", ""))
			var agr_rec: Variant = data.get("agreement", {})
			if agr_rec is Dictionary and not str(agr_rec.get("property_id", "")).is_empty():
				_selected_property_id = str(agr_rec.get("property_id", ""))
			_queue_post_mutation_refresh()


func _queue_post_mutation_refresh() -> void:
	var m_payload := {"filters": _build_market_filters()}
	_pending_reads = [
		{"action": "market", "payload": m_payload},
		{"action": "my_properties", "payload": {}},
		{"action": "my_rentals", "payload": {}},
	]
	if not _selected_property_id.is_empty():
		_pending_reads.append({"action": "view", "payload": {"property_id": _selected_property_id}})


func _build_market_filters() -> Dictionary:
	var filters: Dictionary = {}
	for pair in [
		["location_id", "filter_location"],
		["category_id", "filter_category"],
		["listing_type", "filter_listing_type"],
		["condition", "filter_condition"],
	]:
		var val := str(_form.get(pair[1], ""))
		if not val.is_empty():
			filters[pair[0]] = val
	var min_beds := int(str(_form.get("filter_min_bedrooms", "0")))
	if min_beds > 0:
		filters["min_bedrooms"] = min_beds
	var max_price_trim := str(_form.get("filter_max_price", "")).strip_edges()
	if max_price_trim.is_valid_int() and int(max_price_trim) > 0:
		filters["max_price_ngn"] = int(max_price_trim)
	return filters


func _emit_action(action: String, payload: Dictionary, keep_preserved: bool = false) -> void:
	if not _online or _busy:
		return
	if not keep_preserved:
		_preserved_notice = ""
	_busy = true
	if _preserved_notice.is_empty():
		_notice = "Waiting for the shared property service…"
		_notice_is_error = false
	_render()
	property_action_requested.emit(action, payload.duplicate(true))


func _render() -> void:
	for child in get_children():
		child.queue_free()
	if not _online:
		_text(
			self, "Housing and property actions require the connected shared world.", 14, TEXT_DARK
		)
		_text(self, "Listings, ownership, rentals, and Naira ledger entries are server-validated.")
		return
	_add_header_section()
	_add_navigation_bar()
	add_child(HSeparator.new())
	match _active_tab:
		"owned":
			_render_owned_tab()
		"rentals":
			_render_rentals_tab()
		"inspect":
			_render_inspect_tab()
		_:
			_render_market_tab()


func _add_header_section() -> void:
	_text(self, "Shared-world housing, rentals, and property ledger", 15, GREEN)
	_text(self, "Purchases, rentals, rent payments, maintenance, and furniture post to the ledger.")
	var age := int(_character.get("age", 15))
	var balance := int(_character.get("money", 0))
	var min_age := int(
		(_catalog.get("rules", {}) as Dictionary).get("minimum_purchase_age_years", 18)
	)
	var date_txt := _format_date(_world_date)
	_text(
		self,
		"Cash: ₦%s  ·  Age: %d  ·  Date: %s" % [_format_number(balance), age, date_txt],
		12,
		TEXT_DARK
	)
	if age < min_age:
		_text(
			self,
			"Character is age %d; age %d+ is required to buy or rent." % [age, min_age],
			11,
			WARN_COLOR
		)
	if not _notice.is_empty():
		var color := WARN_COLOR if _notice_is_error else (TEXT_MUTED if _busy else GREEN)
		_text(self, _notice, 12, color)


func _add_navigation_bar() -> void:
	var nav := _row(self)
	_add_tab_button(nav, "Marketplace (%d)" % _market_listings.size(), "market")
	_add_tab_button(nav, "My Properties (%d)" % _owned_properties.size(), "owned")
	_add_tab_button(nav, "My Rentals (%d)" % _rentals.size(), "rentals")
	if not _inspected_property.is_empty():
		var p_name := str(_prop_rec(_inspected_property).get("name", "Property")).left(18)
		_add_tab_button(nav, "Inspect: %s" % p_name, "inspect")
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


func _render_market_tab() -> void:
	_text(self, "Property marketplace", 14, GREEN)
	_add_market_filter_controls()
	if _market_listings.is_empty():
		_text(
			self,
			"No available properties match the current filters. Adjust filters or press Search."
		)
		return
	for item in _market_listings:
		if item is Dictionary:
			_add_market_listing_card(item)


func _add_market_filter_controls() -> void:
	var row1 := _row(self)
	var loc_ids: Array[String] = [""]
	var loc_labels: Array[String] = ["All locations"]
	for loc in _catalog.get("property_locations", []):
		if loc is Dictionary:
			loc_ids.append(str(loc.get("id", "")))
			loc_labels.append(str(loc.get("label", loc.get("id", ""))))
	_option(row1, "filter_location", loc_ids, loc_labels)
	_option(
		row1,
		"filter_category",
		["", "cat:residential", "cat:commercial", "cat:land"],
		["All categories", "Residential", "Commercial", "Land"]
	)
	_option(
		row1, "filter_listing_type", ["", "sale", "rent"], ["Sale & Rent", "For Sale", "For Rent"]
	)

	var row2 := _row(self)
	var cond_ids: Array[String] = [""]
	var cond_labels: Array[String] = ["Any condition"]
	for cond in CONDITIONS:
		cond_ids.append(cond)
		cond_labels.append(_format_status(cond))
	_option(row2, "filter_condition", cond_ids, cond_labels)
	_option(
		row2,
		"filter_min_bedrooms",
		["0", "1", "2", "3"],
		["Any beds", "1+ beds", "2+ beds", "3+ beds"]
	)
	_input(row2, "filter_max_price", "Max ₦ price (optional)", 140.0)
	_btn(row2, "Search", func(): _emit_action("market", {"filters": _build_market_filters()}))
	_btn(
		row2,
		"Reset",
		func():
			for key in [
				"filter_location",
				"filter_category",
				"filter_listing_type",
				"filter_condition",
				"filter_max_price"
			]:
				_form[key] = ""
			_form["filter_min_bedrooms"] = "0"
			_emit_action("market", {"filters": {}})
	)


func _add_market_listing_card(listing: Dictionary) -> void:
	var section := _create_card()
	var listing_type := str(listing.get("listing_type", "sale"))
	var prop_id := str(listing.get("property_id", ""))
	var listing_id := str(listing.get("listing_id", ""))
	var is_own := str(listing.get("owner_id", "")) == str(_character.get("character_id", ""))

	var loc_txt := str(
		listing.get("location_label", _location_label(str(listing.get("location_id", ""))))
	)
	_text(section, "%s  ·  %s" % [str(listing.get("name", prop_id)), loc_txt], 14, TEXT_DARK)
	_text(section, _prop_meta_line(listing))
	var desc := str(listing.get("description", ""))
	if not desc.is_empty():
		_text(section, desc, 11, TEXT_DARK)

	var actions := _row(section)
	if listing_type == "sale":
		var ask := int(listing.get("asking_price_ngn", 0))
		_text(section, "For Sale: ₦%s" % _format_number(ask), 12, GREEN)
		if is_own:
			_text(section, "You are the current owner of this listed property.")
		else:
			var label := "Purchase (₦%s)" % _format_number(ask)
			_btn(actions, label, func(): _emit_action("purchase", {"listing_id": listing_id}))
	else:
		var rent_ngn := int(listing.get("rent_price_ngn", 0))
		var deposit_ngn := int(listing.get("deposit_ngn", 0))
		var period := _format_status(str(listing.get("rent_period", "yearly")))
		var total_due := rent_ngn + deposit_ngn
		var r_txt := (
			"For Rent: ₦%s / %s  ·  Deposit: ₦%s"
			% [_format_number(rent_ngn), period, _format_number(deposit_ngn)]
		)
		_text(section, "%s  ·  Due at start: ₦%s" % [r_txt, _format_number(total_due)], 12, GREEN)
		if is_own:
			_text(section, "You are the landlord of this rental listing.")
		else:
			var label := "Rent now (pay ₦%s)" % _format_number(total_due)
			_btn(actions, label, func(): _emit_action("rent", {"listing_id": listing_id}))
	_btn(actions, "Inspect details", func(): _inspect_property(prop_id))


func _render_owned_tab() -> void:
	_text(self, "Properties owned by your character", 14, GREEN)
	if _owned_properties.is_empty():
		_text(self, "You do not currently own any properties. Browse Marketplace to buy property.")
		return
	for item in _owned_properties:
		if not item is Dictionary:
			continue
		var prop: Dictionary = item
		var prec := _prop_rec(prop)
		var prop_id := _prop_id(prop)
		var section := _create_card()
		var loc := _location_label(str(prec.get("location_id", "")))
		_text(section, "%s  ·  %s" % [str(prec.get("name", prop_id)), loc], 14, TEXT_DARK)
		_text(section, _prop_meta_line(prec))
		var active_listing: Variant = prop.get("active_listing", null)
		if active_listing is Dictionary and bool(active_listing.get("available", false)):
			if str(active_listing.get("listing_type", "sale")) == "sale":
				var ask := _format_number(int(active_listing.get("asking_price_ngn", 0)))
				_text(section, "Active sale listing: ₦%s" % ask, 11, GREEN)
			else:
				var rp := _format_number(int(active_listing.get("rent_price_ngn", 0)))
				var rper := _format_status(str(active_listing.get("rent_period", "yearly")))
				var rdep := _format_number(int(active_listing.get("deposit_ngn", 0)))
				_text(
					section,
					"Active rent listing: ₦%s / %s (deposit ₦%s)" % [rp, rper, rdep],
					11,
					GREEN
				)
		var active_rental: Variant = prop.get("active_rental", null)
		if active_rental is Dictionary and str(active_rental.get("status", "")) == "active":
			var tid := str(active_rental.get("tenant_id", ""))
			var due := _format_date(_agreement_due_date(active_rental))
			_text(section, "Active tenant: %s  ·  Paid through: %s" % [tid, due], 11, TEXT_DARK)
		_btn(section, "Inspect & manage property", func(): _inspect_property(prop_id))


func _render_rentals_tab() -> void:
	_text(self, "Your rental agreements", 14, GREEN)
	_text(self, "Rent is paid per period when due. No automatic deduction, arrears, or eviction.")
	if _rentals.is_empty():
		_text(self, "You have no recorded rental agreements.")
		return
	for item in _rentals:
		if item is Dictionary:
			_add_rental_card(item)


func _add_rental_card(rental: Dictionary) -> void:
	var section := _create_card()
	var agreement_id := str(rental.get("agreement_id", ""))
	var prop_id := str(rental.get("property_id", ""))
	var status := str(rental.get("status", "active"))
	var rent_ngn := int(rental.get("rent_ngn", 0))

	var loc := _location_label(str(rental.get("location_id", "")))
	_text(section, "%s  ·  %s" % [str(rental.get("property_name", prop_id)), loc], 14, TEXT_DARK)
	var meta := (
		"Agreement: %s  ·  Status: %s  ·  Landlord: %s"
		% [agreement_id, _format_status(status), str(rental.get("landlord_id", ""))]
	)
	_text(section, meta)
	_text(section, _rental_amounts_line(rental), 12, TEXT_DARK)

	var full_rental := _full_rental_record(prop_id, agreement_id)
	if not full_rental.is_empty():
		var due_date := _agreement_due_date(full_rental)
		var is_due := _date_key(_world_date) >= _date_key(due_date)
		var due_status := "DUE now" if is_due else "current period paid (not due yet)"
		var due_text := "Paid through: %s  ·  %s" % [_format_date(due_date), due_status]
		_text(section, due_text, 11, WARN_COLOR if is_due else GREEN)
	else:
		_text(section, "Inspect property to view the exact paid-through date for this agreement.")

	var row := _row(section)
	if status == "active":
		var pay_lbl := "Pay next period rent (₦%s)" % _format_number(rent_ngn)
		_btn(row, pay_lbl, func(): _emit_action("pay_rent", {"agreement_id": agreement_id}))
		var term_payload := {"agreement_id": agreement_id, "reason": "Tenant terminated agreement."}
		_btn(row, "Terminate rental", func(): _emit_action("terminate_rental", term_payload))
	_btn(row, "Inspect property & due date", func(): _inspect_property(prop_id))


func _render_inspect_tab() -> void:
	if _inspected_property.is_empty():
		_text(self, "Select a property from Marketplace, My Properties, or My Rentals to inspect.")
		return
	var prop := _inspected_property
	var prec := _prop_rec(prop)
	var prop_id := _prop_id(prop)
	var ownership: Dictionary = (
		prop.get("ownership", {}) if prop.get("ownership", {}) is Dictionary else {}
	)
	var owner_id := str(ownership.get("owner_id", ""))
	var owner_kind := str(ownership.get("owner_kind", ""))
	var is_player_owner := (
		bool(ownership.get("active", false))
		and owner_kind == "player"
		and owner_id == str(_character.get("character_id", ""))
	)

	var info_card := _create_card()
	_text(info_card, "%s (%s)" % [str(prec.get("name", prop_id)), prop_id], 15, GREEN)
	var loc := _location_label(str(prec.get("location_id", "")))
	var dev := _format_status(str(prec.get("development_status", "developed")))
	_text(info_card, "%s  ·  %s  ·  %s" % [_prop_meta_line(prec), loc, dev], 12, TEXT_DARK)
	var amenities: Variant = prec.get("amenities", [])
	if amenities is Array and not amenities.is_empty():
		_text(info_card, "Amenities: %s" % ", ".join(PackedStringArray(amenities)), 11, TEXT_DARK)
	var acq := _format_date(ownership.get("acquisition_world_date", {}))
	_text(info_card, "Current owner: %s (%s)  ·  Acquired: %s" % [owner_id, owner_kind, acq])

	_add_inspected_listing_and_rental(prop, is_player_owner)
	if is_player_owner:
		_add_owner_management_sections(prop)
	_add_inspected_events(prop)


func _add_inspected_listing_and_rental(prop: Dictionary, is_player_owner: bool) -> void:
	var active_listing: Variant = prop.get("active_listing", null)
	if active_listing is Dictionary and bool(active_listing.get("available", false)):
		var listing_card := _create_card()
		var lid := str(active_listing.get("listing_id", ""))
		if str(active_listing.get("listing_type", "sale")) == "sale":
			var ask := int(active_listing.get("asking_price_ngn", 0))
			_text(
				listing_card, "Open Sale Listing (%s): ₦%s" % [lid, _format_number(ask)], 13, GREEN
			)
			if not is_player_owner:
				var lbl := "Purchase property (₦%s)" % _format_number(ask)
				_btn(listing_card, lbl, func(): _emit_action("purchase", {"listing_id": lid}))
		else:
			var rprice := int(active_listing.get("rent_price_ngn", 0))
			var rdep := int(active_listing.get("deposit_ngn", 0))
			var rper := _format_status(str(active_listing.get("rent_period", "yearly")))
			var rline := (
				"Open Rent Listing (%s): ₦%s / %s  ·  Deposit: ₦%s"
				% [lid, _format_number(rprice), rper, _format_number(rdep)]
			)
			_text(listing_card, rline, 13, GREEN)
			if not is_player_owner:
				var lbl := "Rent property (pay ₦%s)" % _format_number(rprice + rdep)
				_btn(listing_card, lbl, func(): _emit_action("rent", {"listing_id": lid}))

	var active_rental: Variant = prop.get("active_rental", null)
	if active_rental is Dictionary and str(active_rental.get("status", "")) == "active":
		var rental_card := _create_card()
		var aid := str(active_rental.get("agreement_id", ""))
		var tenant_id := str(active_rental.get("tenant_id", ""))
		var landlord_id := str(active_rental.get("landlord_id", ""))
		var my_id := str(_character.get("character_id", ""))
		var due_date := _agreement_due_date(active_rental)
		var is_due := _date_key(_world_date) >= _date_key(due_date)
		_text(rental_card, "Active Rental Agreement (%s)" % aid, 13, GREEN)
		_text(rental_card, "Tenant: %s  ·  Landlord: %s" % [tenant_id, landlord_id], 11, TEXT_DARK)
		_text(rental_card, _rental_amounts_line(active_rental), 11, TEXT_DARK)
		var start_txt := _format_date(active_rental.get("start_world_date", {}))
		var due_txt := "%s (%s)" % [_format_date(due_date), "due now" if is_due else "not due yet"]
		_text(
			rental_card,
			"Start: %s  ·  Paid through: %s" % [start_txt, due_txt],
			11,
			WARN_COLOR if is_due else GREEN
		)
		if tenant_id == my_id:
			var rent_amt := _format_number(int(active_rental.get("rent_ngn", 0)))
			var pay_lbl := "Pay next period rent (₦%s)" % rent_amt
			_btn(rental_card, pay_lbl, func(): _emit_action("pay_rent", {"agreement_id": aid}))
		if tenant_id == my_id or landlord_id == my_id:
			var reason_row := _row(rental_card)
			_input(reason_row, "terminate_reason", "Reason for terminating agreement")
			_btn(
				reason_row,
				"Terminate rental",
				func():
					var reason := str(_form.get("terminate_reason", "")).strip_edges()
					_emit_action("terminate_rental", {"agreement_id": aid, "reason": reason})
			)


func _add_owner_management_sections(prop: Dictionary) -> void:
	var prec := _prop_rec(prop)
	var prop_id := _prop_id(prop)
	var is_land := bool(prec.get("is_land", false))

	var listing_box := _create_card()
	_text(listing_box, "Owner listing controls", 13, GREEN)
	var sale_row := _row(listing_box)
	_input(sale_row, "sale_price", "Sale asking price ₦ (min 100,000)")
	_btn(sale_row, "List for sale", func(): _submit_list_for_sale(prop_id))

	if is_land:
		_text(listing_box, "Land parcels cannot be listed for rent (property_land_not_rentable).")
	else:
		var rent_row := _row(listing_box)
		_input(rent_row, "rent_price", "Rent ₦ (min 10,000)")
		var period_labels: Array[String] = []
		for p in RENT_PERIODS:
			period_labels.append(_format_status(p))
		_option(rent_row, "rent_period", RENT_PERIODS, period_labels)
		_input(rent_row, "rent_deposit", "Deposit ₦", 100.0)
		_btn(rent_row, "List for rent", func(): _submit_list_for_rent(prop_id))

	var maint_box := _create_card()
	_text(maint_box, "Maintenance & condition repair", 13, GREEN)
	var mrow := _row(maint_box)
	var cond_labels: Array[String] = []
	for c in CONDITIONS:
		cond_labels.append(_format_status(c))
	_option(mrow, "maint_condition", CONDITIONS, cond_labels)
	_input(mrow, "maint_cost", "Cost ₦", 95.0)
	_input(mrow, "maint_desc", "Maintenance description")
	_btn(mrow, "Record maintenance", func(): _submit_maintenance(prop_id))

	_add_owner_furnishing_card(prop, prop_id, is_land)
	_add_owner_transfer_card(prop_id)


func _add_owner_furnishing_card(prop: Dictionary, prop_id: String, is_land: bool) -> void:
	var furn_box := _create_card()
	_text(furn_box, "Furnishing", 13, GREEN)
	if is_land:
		_text(furn_box, "Land parcels cannot be furnished (property_land_no_furniture).")
		return
	var furnishings: Variant = prop.get("furnishing", [])
	var total_items := 0
	if furnishings is Array and not furnishings.is_empty():
		for f_val in furnishings:
			if not f_val is Dictionary:
				continue
			var f_rec: Dictionary = f_val
			var fid := str(f_rec.get("furnishing_id", ""))
			var fdef_id := str(f_rec.get("furniture_definition_id", ""))
			var qty := int(f_rec.get("quantity", 1))
			total_items += qty
			var f_row := _row(furn_box)
			_text(f_row, "%s  ×%d" % [_furniture_label(fdef_id), qty], 12, TEXT_DARK)
			var rem_payload := {"property_id": prop_id, "furnishing_id": fid}
			_btn(f_row, "Remove", func(): _emit_action("remove_furnishing", rem_payload))
	else:
		_text(furn_box, "No furniture placed in this property yet.")
	_text(furn_box, "Placed furniture items: %d / 30 maximum" % total_items)

	var buy_row := _row(furn_box)
	var furn_ids: Array[String] = []
	var furn_labels: Array[String] = []
	for item in _catalog.get("furniture_catalog", []):
		if item is Dictionary:
			var fid := str(item.get("id", ""))
			var price := _format_number(int(item.get("price_ngn", 0)))
			furn_ids.append(fid)
			furn_labels.append(
				(
					"%s · ₦%s (%s)"
					% [str(item.get("label", fid)), price, str(item.get("category", ""))]
				)
			)
	_option(buy_row, "furnish_id", furn_ids, furn_labels)
	var qty_ids: Array[String] = []
	var qty_labels: Array[String] = []
	for q in range(1, 11):
		qty_ids.append(str(q))
		qty_labels.append("×%d" % q)
	_option(buy_row, "furnish_qty", qty_ids, qty_labels)
	_btn(buy_row, "Buy & place", func(): _submit_furnish(prop_id))


func _add_owner_transfer_card(prop_id: String) -> void:
	var xfer_box := _create_card()
	_text(xfer_box, "Transfer property ownership", 13, GREEN)
	_text(
		xfer_box,
		"Transfers ownership to another adult character (18+) and closes open listings/rentals."
	)
	var row := _row(xfer_box)
	var target_input := _input(row, "transfer_target", "Recipient character_id")
	_btn(row, "Transfer ownership", func(): _submit_transfer(prop_id))
	_add_nearby_player_shortcuts(xfer_box, target_input)


func _add_inspected_events(prop: Dictionary) -> void:
	var events: Variant = prop.get("recent_events", [])
	if not events is Array or events.is_empty():
		return
	var ev_box := _create_card()
	_text(ev_box, "Recent property history", 13, GREEN)
	for ev_val in events.slice(0, mini(6, events.size())):
		if ev_val is Dictionary:
			var dt := _format_date(ev_val.get("world_date", {}))
			_text(
				ev_box, "%s  ·  %s" % [dt, str(ev_val.get("summary", ev_val.get("type", "Event")))]
			)


func _submit_list_for_sale(prop_id: String) -> void:
	var raw := str(_form.get("sale_price", "")).strip_edges()
	if not raw.is_valid_int() or int(raw) < 1:
		_set_local_error("Enter a valid positive asking price in Naira.")
		return
	_emit_action("list_for_sale", {"property_id": prop_id, "asking_price_ngn": int(raw)})


func _submit_list_for_rent(prop_id: String) -> void:
	var raw_rent := str(_form.get("rent_price", "")).strip_edges()
	var raw_dep := str(_form.get("rent_deposit", "0")).strip_edges()
	if not raw_rent.is_valid_int() or int(raw_rent) < 1 or not raw_dep.is_valid_int():
		_set_local_error("Enter valid integer amounts for rent and deposit.")
		return
	_emit_action(
		"list_for_rent",
		{
			"property_id": prop_id,
			"rent_price_ngn": int(raw_rent),
			"rent_period": str(_form.get("rent_period", "yearly")),
			"deposit_ngn": maxi(0, int(raw_dep)),
		}
	)


func _submit_maintenance(prop_id: String) -> void:
	var raw_cost := str(_form.get("maint_cost", "0")).strip_edges()
	var desc := str(_form.get("maint_desc", "")).strip_edges()
	if not raw_cost.is_valid_int() or int(raw_cost) < 0 or desc.is_empty():
		_set_local_error("Provide a maintenance description and a non-negative Naira cost.")
		return
	_emit_action(
		"maintain",
		{
			"property_id": prop_id,
			"description": desc,
			"cost_ngn": int(raw_cost),
			"condition": str(_form.get("maint_condition", "good")),
		}
	)


func _submit_furnish(prop_id: String) -> void:
	var fid := str(_form.get("furnish_id", "furn:bed-single"))
	var qty := clampi(int(str(_form.get("furnish_qty", "1"))), 1, 10)
	_emit_action("furnish", {"property_id": prop_id, "furniture_id": fid, "quantity": qty})


func _submit_transfer(prop_id: String) -> void:
	var target := str(_form.get("transfer_target", "")).strip_edges()
	if target.is_empty():
		_set_local_error("Enter the recipient character ID to transfer ownership.")
	else:
		_emit_action("transfer", {"property_id": prop_id, "to_character_id": target})


func _set_local_error(message_text: String) -> void:
	_notice = message_text
	_notice_is_error = true
	_render()


func _inspect_property(prop_id: String) -> void:
	if not prop_id.is_empty():
		_selected_property_id = prop_id
		if _known_profiles.has(prop_id):
			_inspected_property = (_known_profiles[prop_id] as Dictionary).duplicate(true)
		_active_tab = "inspect"
		_emit_action("view", {"property_id": prop_id})


func _prop_rec(profile: Dictionary) -> Dictionary:
	var nested: Variant = profile.get("property", null)
	return nested if nested is Dictionary else profile


func _prop_id(profile: Dictionary) -> String:
	return str(_prop_rec(profile).get("property_id", profile.get("property_id", "")))


func _full_rental_record(prop_id: String, agreement_id: String) -> Dictionary:
	if _known_profiles.has(prop_id):
		var prof: Dictionary = _known_profiles[prop_id]
		var active: Variant = prof.get("active_rental", null)
		if active is Dictionary and str(active.get("agreement_id", "")) == agreement_id:
			return active
	return {}


func _agreement_due_date(agreement: Dictionary) -> Dictionary:
	var paid_through: Variant = agreement.get("paid_through_world_date", null)
	if paid_through is Dictionary and not paid_through.is_empty():
		return paid_through
	var base: Variant = agreement.get("last_payment_world_date", null)
	if not base is Dictionary or base.is_empty():
		base = agreement.get("start_world_date", {})
	if not base is Dictionary or base.is_empty():
		return {}
	var months: int = {"monthly": 1, "quarterly": 3, "half_yearly": 6}.get(
		str(agreement.get("rent_period", "yearly")), 12
	)
	return _add_months_clamped(base, months)


func _add_months_clamped(date: Dictionary, months: int) -> Dictionary:
	var total := int(date.get("year", 2026)) * 12 + (int(date.get("month", 1)) - 1) + months
	var year := int(floor(float(total) / 12.0))
	var month := (total % 12) + 1
	var max_d := (
		30
		if month in [4, 6, 9, 11]
		else (28 if month == 2 and year % 4 != 0 else (29 if month == 2 else 31))
	)
	return {"year": year, "month": month, "day": mini(int(date.get("day", 1)), max_d)}


func _add_nearby_player_shortcuts(parent: Node, target_input: LineEdit) -> void:
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
				_form["transfer_target"] = cid
				if is_instance_valid(target_input):
					target_input.text = cid
		)


func _has_focused_input() -> bool:
	var vp := get_viewport()
	var focus := vp.gui_get_focus_owner() if vp != null else null
	return focus != null and is_ancestor_of(focus)


func _prop_meta_line(prop: Dictionary) -> String:
	var t_lbl := _catalog_label("property_types", str(prop.get("type_id", "")), "type:")
	var cond := _format_status(str(prop.get("condition", "good")))
	var beds := int(prop.get("bedrooms", 0))
	var baths := int(prop.get("bathrooms", 0))
	var sqm := int(prop.get("size_sqm", 0))
	return "%s · %d bed / %d bath · %d sqm · %s" % [t_lbl, beds, baths, sqm, cond]


func _rental_amounts_line(rental: Dictionary) -> String:
	var rent := _format_number(int(rental.get("rent_ngn", 0)))
	var per := _format_status(str(rental.get("rent_period", "yearly")))
	var dep := _format_number(int(rental.get("deposit_ngn", 0)))
	var paid := _format_number(int(rental.get("total_paid_ngn", 0)))
	return "Rent: ₦%s / %s  ·  Deposit: ₦%s  ·  Total paid: ₦%s" % [rent, per, dep, paid]


func _catalog_label(section_key: String, item_id: String, prefix: String) -> String:
	for entry in _catalog.get(section_key, []):
		if entry is Dictionary and str(entry.get("id", "")) == item_id:
			return str(entry.get("label", item_id))
	return item_id.trim_prefix(prefix).replace("-", " ").capitalize()


func _location_label(loc_id: String) -> String:
	return _catalog_label("property_locations", loc_id, "loc:")


func _furniture_label(fdef_id: String) -> String:
	return _catalog_label("furniture_catalog", fdef_id, "furn:")


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
	if not value is Dictionary or value.is_empty():
		return "date unavailable"
	return _date_key(value)


func _date_key(value: Dictionary) -> String:
	return (
		"%04d-%02d-%02d"
		% [int(value.get("year", 0)), int(value.get("month", 0)), int(value.get("day", 0))]
	)
