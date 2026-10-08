class_name HouseholdFactory
extends RefCounted

const GUARDIAN_NAMES: Array[String] = [
	"Amina",
	"Bisi",
	"Chinwe",
	"Hauwa",
	"Ifeoma",
	"Kemi",
	"Ngozi",
	"Sadiya",
	"Tola",
	"Zainab",
]
const FAMILY_NAMES: Array[String] = [
	"Adeyemi",
	"Bello",
	"Eze",
	"Ibrahim",
	"Okafor",
	"Olawale",
	"Yusuf",
]


static func create_household() -> Dictionary:
	var family_name: String = FAMILY_NAMES[randi_range(0, FAMILY_NAMES.size() - 1)]
	var first_guardian: String = GUARDIAN_NAMES[randi_range(0, GUARDIAN_NAMES.size() - 1)]
	var second_guardian: String = GUARDIAN_NAMES[randi_range(0, GUARDIAN_NAMES.size() - 1)]
	while second_guardian == first_guardian:
		second_guardian = GUARDIAN_NAMES[randi_range(0, GUARDIAN_NAMES.size() - 1)]
	var household_id := _new_id("household")
	return {
		"id": household_id,
		"home_id": "home-" + household_id,
		"neighborhood_id": "idera-quarter",
		"home_type": "Family compound home",
		"rooms": ["Living area", "Bedroom", "Kitchen"],
		"guardians":
		[
			{
				"id": _new_id("npc"),
				"name": "%s %s" % [first_guardian, family_name],
				"role": "parent",
			},
			{
				"id": _new_id("npc"),
				"name": "%s %s" % [second_guardian, family_name],
				"role": "guardian",
			},
		],
	}


static func _new_id(prefix: String) -> String:
	return (
		"%s-%d-%d"
		% [prefix, int(Time.get_unix_time_from_system() * 1000.0), randi_range(100000, 999999)]
	)
