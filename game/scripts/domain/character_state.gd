class_name CharacterState
extends RefCounted

const STARTING_MONEY: int = 5000
const STARTING_SCORES: Dictionary = {
	"Mathematics": 72,
	"English": 68,
	"Computer Studies": 81,
	"Biology": 64,
	"Civic Education": 75,
}

var player_id: String = ""
var character_id: String = ""
var name: String = ""
var age: int = 15
var character_type: String = "androgynous"
var appearance: Dictionary = {}
var money: int = STARTING_MONEY
var health: float = 100.0
var energy: float = 90.0
var hunger: float = 82.0
var education_level: String = "Secondary school (prototype)"
var school_id: String = "idera_secondary_school"
var home_id: String = ""
var current_location: String = "home"
var position: Vector2 = Vector2(720.0, 540.0)
var inventory: Array[Dictionary] = []
var academic_scores: Dictionary = {}
var attendance: Array[Dictionary] = []
var reputation: int = 0
var household: Dictionary = {}
var created_at: String = ""
var updated_at: String = ""


func create_new(
	character_name: String,
	starting_age: int,
	starting_character_type: String,
	starting_appearance: Dictionary,
	starting_household: Dictionary
) -> void:
	var now := _timestamp()
	player_id = _new_id("player")
	character_id = _new_id("character")
	name = character_name.strip_edges()
	if name.is_empty():
		name = "Ayo"
	age = 16 if starting_age == 16 else 15
	character_type = starting_character_type
	appearance = starting_appearance.duplicate(true)
	money = STARTING_MONEY
	health = 100.0
	energy = 90.0
	hunger = 82.0
	education_level = "Secondary school (prototype)"
	school_id = "idera_secondary_school"
	household = starting_household.duplicate(true)
	home_id = str(household.get("home_id", ""))
	current_location = "home"
	position = Vector2(720.0, 540.0)
	inventory.clear()
	add_item("school_bag", "School bag", 1, "school")
	add_item("notebook", "Exercise book", 1, "school")
	add_item("phone", "Basic phone", 1, "personal")
	add_item("meat_pie", "Meat pie", 1, "food", 24)
	add_item("uniform", "School uniform", 1, "clothing")
	academic_scores = STARTING_SCORES.duplicate(true)
	attendance.clear()
	reputation = 0
	created_at = now
	updated_at = now


func add_item(
	item_id: String,
	item_name: String,
	quantity: int = 1,
	category: String = "misc",
	hunger_restore: int = 0
) -> void:
	if quantity <= 0:
		return
	for index in range(inventory.size()):
		var item := inventory[index]
		if str(item.get("id", "")) == item_id:
			item["quantity"] = int(item.get("quantity", 0)) + quantity
			inventory[index] = item
			touch()
			return
	var new_item := {
		"id": item_id,
		"name": item_name,
		"quantity": quantity,
		"category": category,
	}
	if hunger_restore > 0:
		new_item["hunger_restore"] = hunger_restore
	inventory.append(new_item)
	touch()


func consume_item(item_id: String) -> bool:
	for index in range(inventory.size()):
		var item := inventory[index]
		if str(item.get("id", "")) != item_id or int(item.get("quantity", 0)) < 1:
			continue
		var restore := int(item.get("hunger_restore", 0))
		if restore <= 0:
			return false
		item["quantity"] = int(item.get("quantity", 0)) - 1
		if int(item["quantity"]) <= 0:
			inventory.remove_at(index)
		else:
			inventory[index] = item
		hunger = clampf(hunger + float(restore), 0.0, 100.0)
		touch()
		return true
	return false


func try_spend(amount: int) -> bool:
	if amount < 0 or money < amount:
		return false
	money -= amount
	touch()
	return true


func advance_time(minutes: int) -> void:
	if minutes <= 0:
		return
	hunger = maxf(0.0, hunger - float(minutes) * 0.012)
	energy = maxf(0.0, energy - float(minutes) * 0.004)
	if hunger < 8.0 and energy < 8.0:
		health = maxf(1.0, health - float(minutes) * 0.015)


func spend_energy(amount: float) -> void:
	energy = clampf(energy - maxf(amount, 0.0), 0.0, 100.0)


func sleep_until_morning() -> void:
	energy = 100.0
	hunger = maxf(0.0, hunger - 18.0)
	health = minf(100.0, health + 5.0)
	touch()


func set_location(location_id: String, world_position: Vector2) -> void:
	current_location = location_id
	position = world_position
	touch()


func touch() -> void:
	updated_at = _timestamp()


func to_dictionary() -> Dictionary:
	return {
		"player_id": player_id,
		"character_id": character_id,
		"name": name,
		"age": age,
		"character_type": character_type,
		"appearance": appearance.duplicate(true),
		"money": money,
		"health": health,
		"energy": energy,
		"hunger": hunger,
		"education_level": education_level,
		"school_id": school_id,
		"home_id": home_id,
		"current_location": current_location,
		"position": {"x": position.x, "y": position.y},
		"inventory": inventory.duplicate(true),
		"academic_scores": academic_scores.duplicate(true),
		"attendance": attendance.duplicate(true),
		"reputation": reputation,
		"household": household.duplicate(true),
		"created_at": created_at,
		"updated_at": updated_at,
	}


func load_dictionary(data: Dictionary) -> void:
	player_id = str(data.get("player_id", _new_id("player")))
	character_id = str(data.get("character_id", _new_id("character")))
	name = str(data.get("name", "Ayo")).strip_edges()
	if name.is_empty():
		name = "Ayo"
	age = clampi(int(data.get("age", 15)), 15, 16)
	character_type = str(data.get("character_type", "androgynous"))
	var raw_appearance: Variant = data.get("appearance", {})
	appearance = raw_appearance.duplicate(true) if raw_appearance is Dictionary else {}
	money = maxi(0, int(data.get("money", STARTING_MONEY)))
	health = clampf(float(data.get("health", 100.0)), 0.0, 100.0)
	energy = clampf(float(data.get("energy", 90.0)), 0.0, 100.0)
	hunger = clampf(float(data.get("hunger", 82.0)), 0.0, 100.0)
	education_level = str(data.get("education_level", "Secondary school (prototype)"))
	school_id = str(data.get("school_id", "idera_secondary_school"))
	home_id = str(data.get("home_id", ""))
	current_location = str(data.get("current_location", "home"))
	var raw_position: Variant = data.get("position", {})
	if raw_position is Dictionary:
		position = Vector2(float(raw_position.get("x", 720.0)), float(raw_position.get("y", 540.0)))
	else:
		position = Vector2(720.0, 540.0)
	inventory.clear()
	var raw_inventory: Variant = data.get("inventory", [])
	if raw_inventory is Array:
		for entry in raw_inventory:
			if entry is Dictionary:
				inventory.append(entry.duplicate(true))
	var raw_scores: Variant = data.get("academic_scores", {})
	academic_scores = (
		raw_scores.duplicate(true) if raw_scores is Dictionary else STARTING_SCORES.duplicate(true)
	)
	attendance.clear()
	var raw_attendance: Variant = data.get("attendance", [])
	if raw_attendance is Array:
		for record in raw_attendance:
			if record is Dictionary:
				attendance.append(record.duplicate(true))
	reputation = int(data.get("reputation", 0))
	var raw_household: Variant = data.get("household", {})
	household = raw_household.duplicate(true) if raw_household is Dictionary else {}
	created_at = str(data.get("created_at", _timestamp()))
	updated_at = str(data.get("updated_at", _timestamp()))


static func _new_id(prefix: String) -> String:
	return (
		"%s-%d-%d"
		% [prefix, int(Time.get_unix_time_from_system() * 1000.0), randi_range(100000, 999999)]
	)


static func _timestamp() -> String:
	return Time.get_datetime_string_from_system(true)
