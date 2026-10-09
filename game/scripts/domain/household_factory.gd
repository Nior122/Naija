class_name HouseholdFactory
extends RefCounted

const LifeSimulationServiceScript = preload("res://scripts/domain/life_simulation_service.gd")
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


static func _starter_profile(family_generation: Dictionary) -> Dictionary:
	var profiles: Variant = family_generation.get("starter_household_profiles", [])
	if profiles is Array and not profiles.is_empty():
		var profile: Variant = profiles[randi_range(0, profiles.size() - 1)]
		if profile is Dictionary:
			return profile.duplicate(true)
	return {"id": "default-family", "caregiver_roles": ["parent"], "sibling_count": 1}


static func _profile_caregiver_roles(profile: Dictionary) -> Array[String]:
	var roles: Array[String] = []
	var configured_roles: Variant = profile.get("caregiver_roles", [])
	if configured_roles is Array:
		for role in configured_roles:
			if str(role) in ["parent", "guardian"]:
				roles.append(str(role))
	if roles.is_empty():
		roles.append("parent")
	return roles


static func _person_ids(people: Array[Dictionary]) -> Array[String]:
	var ids: Array[String] = []
	for person in people:
		var person_id := str(person.get("person_id", ""))
		if not person_id.is_empty():
			ids.append(person_id)
	return ids


static func _new_family_member(
	name: String,
	age_min: int,
	age_max: int,
	role: String,
	world_date: Dictionary,
	household_id: String,
	family_id: String,
	home_id: String,
	person_id: String = ""
) -> Dictionary:
	var stable_id := person_id if not person_id.is_empty() else _new_id("npc")
	return LifeSimulationServiceScript.new_family_person(
		stable_id,
		name,
		randi_range(age_min, age_max),
		role,
		world_date,
		household_id,
		family_id,
		home_id
	)


static func create_household(world_date: Dictionary = {}) -> Dictionary:
	var start_date := (
		world_date.duplicate(true)
		if LifeSimulationServiceScript.valid_date(world_date)
		else LifeSimulationServiceScript.default_world_date()
	)
	var data := LifeSimulationServiceScript.catalog()
	var generation: Dictionary = data.get("family_generation", {})
	var profile := _starter_profile(generation)
	var caregiver_roles := _profile_caregiver_roles(profile)
	var sibling_count := clampi(int(profile.get("sibling_count", 1)), 1, 4)
	var family_name: String = FAMILY_NAMES[randi_range(0, FAMILY_NAMES.size() - 1)]
	var household_id := _new_id("household")
	var family_id := _new_id("family")
	var home_id := "home-" + household_id
	var parent_min := int(generation.get("starting_parent_age_min_years", 38))
	var parent_max := int(generation.get("starting_parent_age_max_years", 52))
	var sibling_min := int(generation.get("starting_sibling_age_min_years", 8))
	var sibling_max := int(generation.get("starting_sibling_age_max_years", 19))
	var family_members: Array[Dictionary] = []
	var guardians: Array[Dictionary] = []
	for role in caregiver_roles:
		var person := _new_family_member(
			"%s %s" % [GUARDIAN_NAMES[randi_range(0, GUARDIAN_NAMES.size() - 1)], family_name],
			parent_min,
			parent_max,
			role,
			start_date,
			household_id,
			family_id,
			home_id
		)
		family_members.append(person)
		guardians.append(person.duplicate(true))
	var siblings: Array[Dictionary] = []
	for _index in range(sibling_count):
		var sibling := _new_family_member(
			"%s %s" % [GUARDIAN_NAMES[randi_range(0, GUARDIAN_NAMES.size() - 1)], family_name],
			sibling_min,
			sibling_max,
			"sibling",
			start_date,
			household_id,
			family_id,
			home_id
		)
		family_members.append(sibling)
		siblings.append(sibling.duplicate(true))
	var family_member_ids := _person_ids(family_members)
	return {
		"id": household_id,
		"home_id": home_id,
		"family_id": family_id,
		"family_name": family_name,
		"neighborhood_id": "idera-quarter",
		"home_type": "Family compound home",
		"rooms": ["Living area", "Bedroom", "Kitchen"],
		"created_world_date": start_date,
		"member_ids": family_member_ids.duplicate(),
		"family_ids": [family_id],
		"family_members": family_members,
		"guardians": guardians,
		"siblings": siblings,
		"members": family_members.duplicate(true),
		"family_tree":
		{
			"family_id": family_id,
			"family_name": family_name,
			"member_ids": family_member_ids,
			"members": family_members.duplicate(true),
			"relationships": [],
			"parent_family_ids": [],
		},
	}


static func ensure_household(household_value: Dictionary, world_date: Dictionary) -> Dictionary:
	var household := household_value.duplicate(true)
	var family_members: Variant = household.get("family_members", [])
	if (
		family_members is Array
		and not family_members.is_empty()
		and str(household.get("family_id", "")) != ""
	):
		return household
	var household_id := str(household.get("id", ""))
	if household_id.is_empty():
		household_id = _new_id("household")
	var family_id := str(household.get("family_id", ""))
	if family_id.is_empty():
		family_id = _new_id("family")
	var home_id := str(household.get("home_id", ""))
	if home_id.is_empty():
		home_id = "home-" + household_id
	var generation: Dictionary = LifeSimulationServiceScript.catalog().get("family_generation", {})
	var profile := _starter_profile(generation)
	var configured_roles := _profile_caregiver_roles(profile)
	var legacy_guardians: Array = household.get("guardians", [])
	var caregiver_roles: Array[String] = []
	if legacy_guardians.is_empty():
		caregiver_roles = configured_roles
	else:
		for index in range(legacy_guardians.size()):
			var legacy_guardian: Variant = legacy_guardians[index]
			var legacy_role := (
				str(legacy_guardian.get("role", legacy_guardian.get("family_role", "")))
				if legacy_guardian is Dictionary
				else ""
			)
			if legacy_role not in ["parent", "guardian"]:
				legacy_role = configured_roles[index % configured_roles.size()]
			caregiver_roles.append(legacy_role)
	var legacy_siblings: Array = household.get("siblings", [])
	var sibling_count := maxi(
		clampi(int(profile.get("sibling_count", 1)), 1, 4), legacy_siblings.size()
	)
	var parent_min := int(generation.get("starting_parent_age_min_years", 38))
	var parent_max := int(generation.get("starting_parent_age_max_years", 52))
	var sibling_min := int(generation.get("starting_sibling_age_min_years", 8))
	var sibling_max := int(generation.get("starting_sibling_age_max_years", 19))
	var family_name := str(household.get("family_name", ""))
	if (
		family_name.is_empty()
		and not legacy_guardians.is_empty()
		and legacy_guardians[0] is Dictionary
	):
		var words := str(legacy_guardians[0].get("name", "")).split(" ", false)
		if words.size() > 1:
			family_name = words[-1]
	if family_name.is_empty():
		family_name = FAMILY_NAMES[randi_range(0, FAMILY_NAMES.size() - 1)]
	var members: Array[Dictionary] = []
	var guardian_records: Array[Dictionary] = []
	for index in range(caregiver_roles.size()):
		var old: Dictionary = (
			legacy_guardians[index]
			if index < legacy_guardians.size() and legacy_guardians[index] is Dictionary
			else {}
		)
		var npc_id := str(old.get("id", old.get("person_id", _new_id("npc"))))
		var npc_name := str(
			old.get(
				"name",
				"%s %s" % [GUARDIAN_NAMES[randi_range(0, GUARDIAN_NAMES.size() - 1)], family_name]
			)
		)
		var caregiver := _new_family_member(
			npc_name,
			parent_min,
			parent_max,
			caregiver_roles[index],
			world_date,
			household_id,
			family_id,
			home_id,
			npc_id
		)
		members.append(caregiver)
		guardian_records.append(caregiver.duplicate(true))
	var sibling_records: Array[Dictionary] = []
	for index in range(sibling_count):
		var old_sibling: Dictionary = (
			legacy_siblings[index]
			if index < legacy_siblings.size() and legacy_siblings[index] is Dictionary
			else {}
		)
		var sibling_id := str(old_sibling.get("id", old_sibling.get("person_id", _new_id("npc"))))
		var sibling_name := str(
			old_sibling.get(
				"name",
				"%s %s" % [GUARDIAN_NAMES[randi_range(0, GUARDIAN_NAMES.size() - 1)], family_name]
			)
		)
		var sibling := _new_family_member(
			sibling_name,
			sibling_min,
			sibling_max,
			"sibling",
			world_date,
			household_id,
			family_id,
			home_id,
			sibling_id
		)
		members.append(sibling)
		sibling_records.append(sibling.duplicate(true))
	var member_ids := _person_ids(members)
	household["id"] = household_id
	household["home_id"] = home_id
	household["family_id"] = family_id
	household["family_name"] = family_name
	household["neighborhood_id"] = str(household.get("neighborhood_id", "idera-quarter"))
	household["home_type"] = str(household.get("home_type", "Family compound home"))
	household["created_world_date"] = world_date.duplicate(true)
	household["family_ids"] = [family_id]
	household["member_ids"] = member_ids
	household["family_members"] = members
	household["guardians"] = guardian_records
	household["siblings"] = sibling_records
	household["members"] = members.duplicate(true)
	household["family_tree"] = {
		"family_id": family_id,
		"family_name": family_name,
		"member_ids": member_ids.duplicate(),
		"members": members.duplicate(true),
		"relationships": [],
		"parent_family_ids": [],
	}
	return household


static func _new_id(prefix: String) -> String:
	return (
		"%s-%d-%d"
		% [prefix, int(Time.get_unix_time_from_system() * 1000.0), randi_range(100000, 999999)]
	)
