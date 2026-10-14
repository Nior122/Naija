class_name PropertyBusinessContract
extends RefCounted

## Client side of the housing and business interfaces (Stage 41). The server in services/world-api
## is the authority. This file names the operations the server accepts, the payload keys each one
## reads, the roles the server allows, and the catalogues the screens display. services/world-
## api/test/client-housing-business-stage41.test.mjs checks these tables against the server source,
## so a drift fails the test.

const PROPERTY_CATALOG_PATH: String = "res://data/properties/catalog.json"
const BUSINESS_CATALOG_PATH: String = "res://data/businesses/catalog.json"
const SERVICE_CATEGORY: String = "service"

const RENT_PERIODS: Array[String] = ["monthly", "quarterly", "half_yearly", "yearly"]
const PROPERTY_CONDITIONS: Array[String] = ["excellent", "good", "fair", "poor", "requires_repair"]

## Property operations and the payload keys each reads (server: propertyAction in world-engine.ts).
const PROPERTY_ACTIONS: Dictionary = {
	"market": ["filters"],
	"view": ["property_id"],
	"my_properties": [],
	"my_rentals": [],
	"purchase": ["listing_id"],
	"list_for_sale": ["property_id", "asking_price_ngn"],
	"list_for_rent": ["property_id", "rent_price_ngn", "rent_period", "deposit_ngn"],
	"rent": ["listing_id"],
	"pay_rent": ["agreement_id"],
	"terminate_rental": ["agreement_id", "reason"],
	"maintain": ["property_id", "description", "cost_ngn", "condition"],
	"furnish": ["property_id", "furniture_id", "quantity"],
	"remove_furnishing": ["property_id", "furnishing_id"],
	"transfer": ["property_id", "to_character_id"],
}
const PROPERTY_CHANGING_ACTIONS: Array[String] = [
	"purchase", "list_for_sale", "list_for_rent", "rent", "pay_rent", "terminate_rental", "maintain",
		"furnish",
	"remove_furnishing", "transfer",
]

## Business operations the Stage 43 screen sends, and the payload keys each one reads (server:
## businessAction in world-engine.ts). Stage 43 added create, add_product, add_service,
## set_listing (deactivate and reactivate), update_price, hire_employee, fire_employee, add_branch,
## and transfer_ownership. Not sent by this screen, and recorded as gaps in
## docs/STAGE_43_BUSINESS_LIFECYCLE.md: record_expense (no client yet), and co-owner add or remove
## (not implemented on the server). Stage 45 added produce
## (docs/STAGE_45_BUSINESS_PRODUCTION.md). A client that does not name an action here cannot
## send it.
const BUSINESS_ACTIONS: Dictionary = {
	"discover": [],
	"view": ["business_id"],
	"create": ["template_id", "name", "description", "location_id", "initial_capital_ngn"],
	"add_product": ["business_id", "product_definition_id", "custom_price_ngn"],
	"add_service": ["business_id", "product_definition_id", "custom_price_ngn"],
	"set_listing": ["business_id", "product_record_id", "available"],
	"update_price": ["business_id", "product_record_id", "price_ngn"],
	"buy_product": ["business_id", "product_record_id", "quantity"],
	"buy_service": ["business_id", "product_record_id"],
	"restock": ["business_id", "product_definition_id", "quantity", "unit_cost_ngn"],
	"produce": ["business_id", "recipe_id"],
	"pay_salary": ["business_id", "employee_character_id", "amount_ngn"],
	"hire_employee": ["business_id", "employee_character_id"],
	"fire_employee": ["business_id", "employee_character_id", "reason"],
	"transfer_funds": ["business_id", "to_business_id", "amount_ngn"],
	"contribute_capital": ["business_id", "amount_ngn"],
	"withdraw": ["business_id", "amount_ngn"],
	"add_branch": ["business_id", "name", "location_id", "premises_type"],
	"transfer_ownership": ["business_id", "to_character_id", "new_role", "share_percent"],
	"close": ["business_id", "reason"],
}
const BUSINESS_CHANGING_ACTIONS: Array[String] = [
	"create", "add_product", "add_service", "set_listing", "update_price", "buy_product",
	"buy_service", "restock", "produce", "pay_salary", "hire_employee", "fire_employee",
	"transfer_funds",
	"contribute_capital", "withdraw", "add_branch", "transfer_ownership", "close",
]

## The roles that the server's authorizeBusinessAction allows, for each role-restricted operation
## the screen sends. Buying and creating have no role restriction; an owner or co-owner is refused
## for their own business (business_self_purchase). The server checks again on every request.
const BUSINESS_ROLES: Dictionary = {
	"add_product": ["owner", "co_owner", "manager", "inventory_manager"],
	"add_service": ["owner", "co_owner", "manager", "inventory_manager"],
	"set_listing": ["owner", "co_owner", "manager"],
	"update_price": ["owner", "co_owner", "manager"],
	"restock": ["owner", "co_owner", "manager", "inventory_manager"],
	"produce": ["owner", "co_owner", "manager"],
	"pay_salary": ["owner", "co_owner"],
	"hire_employee": ["owner", "co_owner", "manager"],
	"fire_employee": ["owner", "co_owner", "manager"],
	"transfer_funds": ["owner", "co_owner"],
	"contribute_capital": ["owner", "co_owner"],
	"withdraw": ["owner", "co_owner"],
	"add_branch": ["owner", "co_owner"],
	"transfer_ownership": ["owner"],
	"close": ["owner", "co_owner"],
}

static var _property_catalog: Dictionary = {}
static var _business_catalog: Dictionary = {}


## Reads a catalogue file bundled with the project. Returns {} when the file is missing or is not a
## JSON object.
static func load_catalog(path: String) -> Dictionary:
	if not FileAccess.file_exists(path):
		push_error("The catalogue is missing: %s" % path)
		return {}
	var file := FileAccess.open(path, FileAccess.READ)
	if file == null:
		push_error("The catalogue could not be opened: %s" % path)
		return {}
	var parsed: Variant = JSON.parse_string(file.get_as_text())
	file.close()
	return parsed if parsed is Dictionary else {}


static func property_catalog() -> Dictionary:
	if _property_catalog.is_empty():
		_property_catalog = load_catalog(PROPERTY_CATALOG_PATH)
	return _property_catalog


static func business_catalog() -> Dictionary:
	if _business_catalog.is_empty():
		_business_catalog = load_catalog(BUSINESS_CATALOG_PATH)
	return _business_catalog


## The furniture the server sells (furnish takes one of these IDs).
static func furniture_definitions() -> Array:
	var rows: Variant = property_catalog().get("furniture_catalog", [])
	return rows.duplicate(true) if rows is Array else []


static func furniture_label(furniture_id: String) -> String:
	for row in furniture_definitions():
		if row is Dictionary and str(row.get("id", "")) == furniture_id:
			return str(row.get("label", furniture_id))
	return furniture_id


## The business product definitions a business can stock or sell.
static func business_product_definitions() -> Array:
	var rows: Variant = business_catalog().get("business_products", [])
	return rows.duplicate(true) if rows is Array else []


## The stock goods a business can buy in and list (every definition that is not a service).
static func goods_definitions() -> Array:
	return business_product_definitions().filter(
		func(row): return str(row.get("category", "")) != SERVICE_CATEGORY)


## The services a business can list (every definition in the service category).
static func service_definitions() -> Array:
	return business_product_definitions().filter(
		func(row): return str(row.get("category", "")) == SERVICE_CATEGORY)


## The business templates a founder can start, that the catalogue marks active.
static func business_templates() -> Array:
	var rows: Variant = business_catalog().get("templates", [])
	var active: Array = []
	if rows is Array:
		for row in rows:
			if row is Dictionary and bool(row.get("active", true)):
				active.append(row.duplicate(true))
	return active


## One business template by ID, active or not, or an empty Dictionary.
static func template_definition(template_id: String) -> Dictionary:
	var rows: Variant = business_catalog().get("templates", [])
	if rows is Array:
		for row in rows:
			if row is Dictionary and str(row.get("id", "")) == template_id:
				return row.duplicate(true)
	return {}


## The premises types the server accepts for a branch (the catalogue's list).
static func premises_types() -> Array:
	var rows: Variant = business_catalog().get("premises_types", [])
	return rows.duplicate() if rows is Array else []


static func product_definition(definition_id: String) -> Dictionary:
	for row in business_product_definitions():
		if row is Dictionary and str(row.get("id", "")) == definition_id:
			return row
	return {}


## A service is bought with buy_service; a stock product with buy_product. The server uses the same
## category rule when it seeds a business, and it refuses the other route
## (business_sale_not_service, business_sale_is_service).
static func is_service_product(definition_id: String) -> bool:
	return str(product_definition(definition_id).get("category", "")) == SERVICE_CATEGORY


## The production recipes this business's template can run, in catalogue order, for the owner's
## production panel. Each row has the recipe ID, its label, its inputs (label and quantity), its
## output (label and quantity), and the operating cost. The server decides every run. The
## catalogue's duration is not used: a run completes when the server accepts it.
static func production_recipes_for(template_id: String) -> Array:
	var rows: Array = []
	var template := template_definition(template_id)
	var template_recipes: Variant = template.get("production_recipes", [])
	if not bool(template.get("requires_production", false)) or not template_recipes is Array:
		return rows
	var catalogue: Variant = business_catalog().get("production_recipes", [])
	if not catalogue is Array:
		return rows
	for recipe in catalogue:
		if not recipe is Dictionary or not bool(recipe.get("active", false)):
			continue
		if not template_recipes.has(str(recipe.get("id", ""))):
			continue
		var inputs: Array = []
		for input in recipe.get("inputs", []):
			var product := product_definition(str(input.get("product_id", "")))
			inputs.append({
				"label": str(product.get("label", input.get("product_id", ""))),
				"quantity": int(input.get("quantity", 0)),
			})
		var output := product_definition(str(recipe.get("output_product_id", "")))
		rows.append({
			"id": str(recipe.get("id", "")),
			"label": str(recipe.get("label", "")),
			"inputs": inputs,
			"output_label": str(output.get("label", recipe.get("output_product_id", ""))),
			"output_quantity": int(recipe.get("output_quantity", 0)),
			"operating_cost_ngn": int(recipe.get("operating_cost_ngn", 0)),
		})
	return rows


## The active owner records of a business profile, optionally only one role set.
static func active_owners(profile: Dictionary) -> Array:
	var rows: Array = []
	var owners: Variant = profile.get("owners", [])
	if owners is Array:
		for row in owners:
			if row is Dictionary and bool(row.get("active", false)):
				rows.append(row)
	return rows


## The role this character holds in a business profile, or "" when they hold none.
static func role_of(profile: Dictionary, character_id: String) -> String:
	for row in active_owners(profile):
		if str(row.get("character_id", "")) == character_id:
			return str(row.get("role", ""))
	return ""


static func can_perform(action_name: String, role: String) -> bool:
	if not BUSINESS_ROLES.has(action_name):
		return true
	var allowed: Array = BUSINESS_ROLES[action_name]
	return allowed.has(role)


## Whole Naira with thousands separators, for example ₦12,500. Negative values keep their sign.
static func naira(value: Variant) -> String:
	var amount := int(value)
	var sign_text := "-" if amount < 0 else ""
	var digits := str(absi(amount))
	var grouped := ""
	for index in range(digits.length()):
		if index > 0 and (digits.length() - index) % 3 == 0:
			grouped += ","
		grouped += digits.substr(index, 1)
	return "₦%s%s" % [sign_text, grouped]


## A world date as YYYY-MM-DD, or a dash when it is missing.
static func date_text(value: Variant) -> String:
	if not value is Dictionary or value.is_empty():
		return "—"
	return "%04d-%02d-%02d" % [
		int(value.get("year", 0)), int(value.get("month", 0)), int(value.get("day", 0))
	]


## Parses a whole number typed by the player. Returns -1 when the text is not a non-negative whole
## number. The server still checks the range; this only stops an obviously wrong entry from being
## sent.
static func parse_whole(text_value: String) -> int:
	var trimmed := text_value.strip_edges().replace(",", "")
	if trimmed.is_empty() or not trimmed.is_valid_int():
		return -1
	var parsed := int(trimmed)
	return parsed if parsed >= 0 else -1


## A word for a snake_case identifier, for display: "half_yearly" becomes "Half yearly".
static func label_for(identifier: String) -> String:
	var spaced := identifier.replace("_", " ").strip_edges()
	if spaced.is_empty():
		return "—"
	return spaced.substr(0, 1).to_upper() + spaced.substr(1)
