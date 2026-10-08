class_name StarterWorld
extends Node2D

const MAP_SIZE: Vector2 = Vector2(1600.0, 900.0)
const ENTITY_SCRIPT = preload("res://scripts/world/world_entity.gd")
const GEOGRAPHIC_REGION_SCRIPT = preload("res://scripts/world/geographic_region_preview.gd")
const EducationServiceScript = preload("res://scripts/domain/education_service.gd")
const LOCATION_NAMES: Dictionary = {
	"town": "Idera Quarter · Streets",
	"home": "Family home · Living area and bedroom",
	"schoolyard": "Idera Community Secondary School · Yard",
	"classroom": "Idera Community Secondary School · Classroom",
	"campus": "Idera tertiary campus · Fictional institutions",
	"training_center": "Idera Community Skills Centre · Workshops",
	"market": "Neighbourhood market · Small shop",
	"clinic": "Community clinic",
	"police_station": "Neighbourhood police station",
	"community_hall": "Community hall",
}

var location_id: String = "town"
var household: Dictionary = {}
var daypart: String = "Morning"
var active_entities: Array[WorldEntity] = []
var focused_entity: WorldEntity
var geography_preview_enabled: bool = false
var _geographic_entities: Array[WorldEntity] = []
var _geography_layer: GeographicRegionPreview


static func is_valid_location(value: String) -> bool:
	return LOCATION_NAMES.has(value)


static func location_name(value: String) -> String:
	return str(LOCATION_NAMES.get(value, "Idera Quarter"))


func set_geographic_preview(enabled: bool) -> bool:
	if location_id != "town":
		return false
	if geography_preview_enabled == enabled:
		return true
	if enabled:
		var preview: GeographicRegionPreview = GEOGRAPHIC_REGION_SCRIPT.new()
		if not preview.load_region():
			push_warning(preview.load_error)
			preview.queue_free()
			return false
		_geography_layer = preview
		add_child(_geography_layer)
		move_child(_geography_layer, 0)
		geography_preview_enabled = true
		for entity in active_entities:
			if is_instance_valid(entity):
				entity.visible = false
		for feature in _geography_layer.get_interactable_features():
			_add_geographic_feature(feature)
	else:
		geography_preview_enabled = false
		for entity in _geographic_entities:
			active_entities.erase(entity)
			if is_instance_valid(entity):
				entity.queue_free()
		_geographic_entities.clear()
		if is_instance_valid(_geography_layer):
			_geography_layer.queue_free()
		_geography_layer = null
		for entity in active_entities:
			if is_instance_valid(entity):
				entity.visible = true
	focused_entity = null
	queue_redraw()
	return true


func geographic_location_for_position(world_position: Vector2) -> Dictionary:
	if not geography_preview_enabled or not is_instance_valid(_geography_layer):
		return {}
	return _geography_layer.geographic_location_for_viewport(world_position)


func geographic_region_id() -> String:
	if is_instance_valid(_geography_layer):
		return _geography_layer.get_region_id()
	return "ng:region:ondo:akure-south-core"


func enter_location(next_location: String, family_data: Dictionary) -> void:
	if not is_valid_location(next_location):
		next_location = "home"
	_clear_entities()
	location_id = next_location
	household = family_data.duplicate(true)
	focused_entity = null
	match location_id:
		"town":
			_populate_town()
		"home":
			_populate_home()
		"schoolyard":
			_populate_schoolyard()
		"classroom":
			_populate_classroom()
		"campus":
			_populate_campus()
		"training_center":
			_populate_training_center()
		"market":
			_populate_market()
		"clinic":
			_populate_clinic()
		"police_station":
			_populate_police_station()
		"community_hall":
			_populate_community_hall()
	queue_redraw()


func update_daypart(value: String) -> void:
	if daypart == value:
		return
	daypart = value
	queue_redraw()


func set_focused_entity(entity: WorldEntity) -> void:
	if focused_entity == entity:
		return
	if is_instance_valid(focused_entity):
		focused_entity.set_focused(false)
	focused_entity = entity
	if is_instance_valid(focused_entity):
		focused_entity.set_focused(true)


func nearest_interactable(world_position: Vector2) -> WorldEntity:
	var nearest: WorldEntity
	var best_distance := INF
	for entity in active_entities:
		if not is_instance_valid(entity) or not entity.visible or entity.action_id.is_empty():
			continue
		var distance := world_position.distance_to(entity.position)
		if distance <= entity.interaction_radius and distance < best_distance:
			nearest = entity
			best_distance = distance
	return nearest


func _clear_entities() -> void:
	geography_preview_enabled = false
	_geographic_entities.clear()
	if is_instance_valid(_geography_layer):
		_geography_layer.queue_free()
	_geography_layer = null
	for entity in active_entities:
		if is_instance_valid(entity):
			entity.queue_free()
	active_entities.clear()


func _add_object(
	entity_id: String,
	label: String,
	world_position: Vector2,
	action: String,
	interaction_prompt: String,
	payload: Dictionary = {}
) -> WorldEntity:
	return _add_entity(
		entity_id, label, world_position, action, interaction_prompt, payload, "", false, Rect2()
	)


func _add_geographic_feature(feature: Dictionary) -> void:
	if not is_instance_valid(_geography_layer):
		return
	var kind := str(feature.get("kind", "geographic_feature"))
	var source_name: Variant = feature.get("name", null)
	var label := str(source_name).strip_edges() if source_name is String else ""
	if label.is_empty():
		label = "School" if kind == "school" else "Health facility"
	var osm_id := str(feature.get("osm_id", ""))
	var entity := _add_object(
		"osm-%s-%s" % [kind, osm_id],
		label,
		_geography_layer.feature_viewport_position(feature),
		"inspect_geographic_feature",
		"Inspect " + label,
		{
			"name": label,
			"kind": kind,
			"osm_id": osm_id,
			"source_layer": str(feature.get("source_layer", "")),
			"attribution": "© OpenStreetMap contributors · ODbL 1.0",
		}
	)
	entity.entity_type = "object"
	entity.queue_redraw()
	_geographic_entities.append(entity)


func _add_npc(
	entity_id: String,
	label: String,
	world_position: Vector2,
	role: String,
	roaming_area: Rect2 = Rect2(),
	can_wander: bool = false
) -> WorldEntity:
	var npc := _add_entity(
		entity_id,
		label,
		world_position,
		"talk",
		"Talk to " + label,
		{},
		role,
		can_wander,
		roaming_area
	)
	npc.entity_type = "npc"
	npc.queue_redraw()
	return npc


func _add_entity(
	entity_id: String,
	label: String,
	world_position: Vector2,
	action: String,
	interaction_prompt: String,
	payload: Dictionary,
	role: String,
	can_wander: bool,
	roaming_area: Rect2
) -> WorldEntity:
	var entity: WorldEntity = ENTITY_SCRIPT.new()
	entity.position = world_position
	(
		entity
		. configure(
			{
				"id": entity_id,
				"name": label,
				"type": "npc" if can_wander else "object",
				"action_id": action,
				"prompt": interaction_prompt,
				"data": payload,
				"dialogue_key": role,
				"roam_bounds": roaming_area,
				"walk_speed": 27.0,
			}
		)
	)
	add_child(entity)
	active_entities.append(entity)
	return entity


func _populate_town() -> void:
	_add_object(
		"home-door",
		"Family home",
		Vector2(270.0, 485.0),
		"travel",
		"Enter your family home",
		{"location": "home", "spawn": Vector2(220.0, 600.0)}
	)
	_add_object(
		"school-gate",
		"School gate",
		Vector2(920.0, 455.0),
		"travel",
		"Enter the school yard",
		{"location": "schoolyard", "spawn": Vector2(240.0, 650.0)}
	)
	_add_object(
		"market-door",
		"Market shop",
		Vector2(520.0, 650.0),
		"travel",
		"Visit the neighbourhood shop",
		{"location": "market", "spawn": Vector2(220.0, 600.0)}
	)
	_add_object(
		"clinic-door",
		"Community clinic",
		Vector2(1250.0, 515.0),
		"travel",
		"Enter the community clinic",
		{"location": "clinic", "spawn": Vector2(220.0, 600.0)}
	)
	_add_object(
		"station-door",
		"Police station",
		Vector2(1330.0, 730.0),
		"travel",
		"Visit the neighbourhood station",
		{"location": "police_station", "spawn": Vector2(220.0, 600.0)}
	)
	_add_object(
		"hall-door",
		"Community hall",
		Vector2(930.0, 730.0),
		"travel",
		"Visit the community hall",
		{"location": "community_hall", "spawn": Vector2(220.0, 600.0)}
	)
	_add_object(
		"bus-stop",
		"Bus stop",
		Vector2(625.0, 495.0),
		"bus_to_school",
		"Take the bus to school · ₦150",
		{}
	)
	_add_npc(
		"pedestrian-amara",
		"Amara",
		Vector2(450.0, 420.0),
		"pedestrian",
		Rect2(Vector2(350.0, 370.0), Vector2(330.0, 90.0)),
		true
	)
	_add_npc(
		"pedestrian-tunde",
		"Tunde",
		Vector2(820.0, 610.0),
		"pedestrian",
		Rect2(Vector2(840.0, 620.0), Vector2(400.0, 95.0)),
		true
	)
	_add_npc(
		"pedestrian-hauwa",
		"Hauwa",
		Vector2(1110.0, 385.0),
		"pedestrian",
		Rect2(Vector2(1010.0, 350.0), Vector2(180.0, 100.0)),
		true
	)


func _populate_home() -> void:
	_add_object(
		"home-front-door",
		"Front door",
		Vector2(220.0, 600.0),
		"travel",
		"Step out into Idera Quarter",
		{"location": "town", "spawn": Vector2(300.0, 500.0)}
	)
	_add_object("home-bed", "Your bed", Vector2(440.0, 350.0), "sleep", "Sleep until morning", {})
	_add_object(
		"home-fridge",
		"Kitchen cupboard",
		Vector2(1030.0, 320.0),
		"inventory",
		"Check your bag and food",
		{}
	)
	var guardians: Array = household.get("guardians", [])
	for index in range(guardians.size()):
		var guardian: Dictionary = guardians[index]
		var role := str(guardian.get("role", "guardian"))
		var dialogue_role := "parent" if index == 0 else role
		var npc_position := Vector2(710.0 + float(index) * 125.0, 530.0)
		_add_npc(
			str(guardian.get("id", "guardian-%d" % index)),
			str(guardian.get("name", "Family guardian")),
			npc_position,
			dialogue_role
		)


func _populate_schoolyard() -> void:
	_add_object(
		"school-exit",
		"School gate",
		Vector2(180.0, 650.0),
		"travel",
		"Leave school and return to the neighbourhood",
		{"location": "town", "spawn": Vector2(900.0, 475.0)}
	)
	_add_object(
		"classroom-door",
		"Classroom door",
		Vector2(1120.0, 500.0),
		"travel",
		"Enter your classroom",
		{"location": "classroom", "spawn": Vector2(260.0, 650.0)}
	)
	_add_object(
		"tertiary-campus-gate",
		"Tertiary campus gate",
		Vector2(1400.0, 550.0),
		"travel",
		"Enter the campus for your enrolled program",
		{"location": "campus", "spawn": Vector2(260.0, 650.0)}
	)
	_add_object(
		"community-skills-centre",
		"Community skills centre",
		Vector2(1400.0, 690.0),
		"travel",
		"Enter the skills centre for training",
		{"location": "training_center", "spawn": Vector2(260.0, 650.0)}
	)
	_add_object(
		"yard-timetable",
		"Notice board",
		Vector2(530.0, 390.0),
		"timetable",
		"Read today's school timetable",
		{}
	)
	_add_object(
		"school-assembly",
		"Morning assembly",
		Vector2(420.0, 390.0),
		"education_activity",
		"Join a scheduled school activity",
		{"activity_id": "morning-assembly"}
	)
	_add_object(
		"school-club",
		"School club",
		Vector2(670.0, 390.0),
		"education_activity",
		"Join a scheduled school activity",
		{"activity_id": "school-club"}
	)
	_add_npc("teacher-yard", "Mr. Okafor", Vector2(770.0, 530.0), "teacher")
	var npc_students: Array = EducationServiceScript.catalog().get("npc_students", [])
	var positions: Array[Vector2] = [
		Vector2(480.0, 560.0), Vector2(650.0, 590.0), Vector2(550.0, 520.0)
	]
	for index in range(mini(3, npc_students.size())):
		var student: Dictionary = npc_students[index]
		_add_npc(
			str(student.get("id", "student-yard-%d" % index)),
			str(student.get("name", "Student")),
			positions[index],
			"student",
			Rect2(Vector2(380.0, 460.0), Vector2(360.0, 155.0)),
			true
		)


func _populate_classroom() -> void:
	_add_object(
		"classroom-exit",
		"Classroom door",
		Vector2(180.0, 650.0),
		"travel",
		"Return to the school yard",
		{"location": "schoolyard", "spawn": Vector2(1050.0, 560.0)}
	)
	_add_object(
		"classroom-desk",
		"Your desk",
		Vector2(820.0, 560.0),
		"attend_class",
		"Attend the next class activity",
		{}
	)
	_add_object(
		"classroom-board",
		"Class notice board",
		Vector2(1020.0, 300.0),
		"timetable",
		"Check the daily timetable",
		{}
	)
	_add_npc("teacher-classroom", "Mr. Okafor", Vector2(800.0, 350.0), "teacher")
	_add_npc("student-classroom", "Aisha", Vector2(610.0, 500.0), "student")
	_add_npc("student-classroom-tunde", "Tunde", Vector2(1050.0, 520.0), "student")


func _populate_campus() -> void:
	_add_object(
		"campus-exit",
		"Campus gate",
		Vector2(180.0, 650.0),
		"travel",
		"Return to the school yard",
		{"location": "schoolyard", "spawn": Vector2(1370.0, 550.0)}
	)
	_add_object(
		"campus-course-desk",
		"Course desk",
		Vector2(820.0, 560.0),
		"begin_course",
		"Attend the next course assessment",
		{}
	)
	_add_object(
		"campus-program-board",
		"Program board",
		Vector2(1020.0, 300.0),
		"education_panel",
		"Review your program and semester",
		{}
	)
	var teachers: Array = EducationServiceScript.catalog().get("teachers", [])
	for teacher in teachers:
		if (
			str(teacher.get("institution_id", ""))
			in [
				"idera_metropolitan_university",
				"idera-technical-polytechnic",
				"idera-college-of-education"
			]
		):
			_add_npc(
				"campus-" + str(teacher.get("id", "tutor")),
				str(teacher.get("name", "Lecturer")),
				Vector2(790.0, 390.0),
				"teacher"
			)
			break
	var npc_students: Array = EducationServiceScript.catalog().get("npc_students", [])
	for index in range(mini(2, npc_students.size())):
		var student: Dictionary = npc_students[index]
		_add_npc(
			"campus-" + str(student.get("id", "student-%d" % index)),
			str(student.get("name", "Student")),
			Vector2(610.0 + float(index) * 320.0, 500.0),
			"student"
		)


func _populate_training_center() -> void:
	_add_object(
		"training-centre-exit",
		"Skills centre exit",
		Vector2(180.0, 650.0),
		"travel",
		"Return to the school yard",
		{"location": "schoolyard", "spawn": Vector2(1370.0, 690.0)}
	)
	_add_object(
		"training-practice-bench",
		"Practice workshop",
		Vector2(820.0, 560.0),
		"practice_training",
		"Complete a practical training session",
		{}
	)
	_add_object(
		"training-course-board",
		"Skills course board",
		Vector2(1020.0, 300.0),
		"education_panel",
		"Review your trade or apprenticeship",
		{}
	)
	for teacher in EducationServiceScript.catalog().get("teachers", []):
		if str(teacher.get("institution_id", "")) == "idera-community-skills-centre":
			_add_npc(
				"training-" + str(teacher.get("id", "mentor")),
				str(teacher.get("name", "Community mentor")),
				Vector2(790.0, 390.0),
				"teacher"
			)
			break


func _populate_market() -> void:
	_add_object(
		"market-exit",
		"Shop entrance",
		Vector2(180.0, 650.0),
		"travel",
		"Return to the neighbourhood",
		{"location": "town", "spawn": Vector2(540.0, 660.0)}
	)
	_add_object(
		"market-shelf", "Food shelf", Vector2(1190.0, 440.0), "shop", "Browse food and water", {}
	)
	_add_npc("shopkeeper", "Mama Sade", Vector2(920.0, 450.0), "shopkeeper")


func _populate_clinic() -> void:
	_add_object(
		"clinic-exit",
		"Clinic entrance",
		Vector2(180.0, 650.0),
		"travel",
		"Return to the neighbourhood",
		{"location": "town", "spawn": Vector2(1250.0, 530.0)}
	)
	_add_object(
		"clinic-desk",
		"Reception desk",
		Vector2(1080.0, 470.0),
		"clinic_care",
		"Ask the nurse for basic care · ₦300",
		{}
	)
	_add_npc("clinic-nurse", "Nurse Ifeoma", Vector2(920.0, 450.0), "nurse")


func _populate_police_station() -> void:
	_add_object(
		"station-exit",
		"Station entrance",
		Vector2(180.0, 650.0),
		"travel",
		"Return to the neighbourhood",
		{"location": "town", "spawn": Vector2(1330.0, 740.0)}
	)
	_add_object(
		"station-information",
		"Help desk",
		Vector2(1090.0, 470.0),
		"talk",
		"Ask about neighbourhood safety",
		{"dialogue_key": "officer"}
	)
	_add_npc("station-officer", "Officer Musa", Vector2(900.0, 450.0), "officer")


func _populate_community_hall() -> void:
	_add_object(
		"hall-exit",
		"Hall entrance",
		Vector2(180.0, 650.0),
		"travel",
		"Return to the neighbourhood",
		{"location": "town", "spawn": Vector2(930.0, 740.0)}
	)
	_add_object(
		"hall-board",
		"Community notice board",
		Vector2(1140.0, 430.0),
		"community_info",
		"Read a neighbourhood notice",
		{}
	)
	_add_npc("community-host", "Ms. Kemi", Vector2(920.0, 450.0), "community")


func _draw() -> void:
	match location_id:
		"town":
			if not geography_preview_enabled:
				_draw_town()
		"home":
			_draw_home()
		"schoolyard":
			_draw_schoolyard()
		"classroom":
			_draw_classroom()
		"campus":
			_draw_public_room(
				Color("#dce8e0"),
				"IDERA TERTIARY CAMPUS",
				"Fictional university, ND / HND polytechnic and NCE study"
			)
		"training_center":
			_draw_public_room(
				Color("#e2d6bc"),
				"COMMUNITY SKILLS CENTRE",
				"Fictional vocational practice and mentored apprenticeship"
			)
		"market":
			_draw_market()
		"clinic":
			_draw_public_room(
				Color("#d9eadf"), "COMMUNITY CLINIC", "A welcoming local health service"
			)
		"police_station":
			_draw_public_room(
				Color("#dce3e8"), "NEIGHBOURHOOD STATION", "A small community help desk"
			)
		"community_hall":
			_draw_public_room(Color("#f0e6cf"), "COMMUNITY HALL", "A place for neighbours to meet")
	if daypart == "Evening" or daypart == "Night":
		var tint_alpha := 0.10 if daypart == "Evening" else 0.20
		draw_rect(Rect2(Vector2.ZERO, MAP_SIZE), Color(0.08, 0.12, 0.28, tint_alpha), true)
	if not geography_preview_enabled:
		_draw_text(
			"IDERA QUARTER · A FICTIONAL NIGERIAN NEIGHBOURHOOD",
			Vector2(34.0, 45.0),
			23,
			Color("#f9f4df")
		)


func _draw_town() -> void:
	draw_rect(Rect2(Vector2.ZERO, MAP_SIZE), Color("#89a968"), true)
	# Local roads, footpaths and a simple central junction.
	draw_rect(Rect2(Vector2(0.0, 475.0), Vector2(1600.0, 130.0)), Color("#615f56"), true)
	draw_rect(Rect2(Vector2(700.0, 0.0), Vector2(115.0, 900.0)), Color("#615f56"), true)
	draw_line(Vector2(0.0, 540.0), Vector2(1600.0, 540.0), Color("#e6c95c"), 3.0, true)
	draw_line(Vector2(757.0, 0.0), Vector2(757.0, 900.0), Color("#e6c95c"), 3.0, true)
	draw_rect(Rect2(Vector2(32.0, 170.0), Vector2(585.0, 285.0)), Color("#729353"), true)
	_draw_house(
		Rect2(Vector2(150.0, 235.0), Vector2(300.0, 205.0)),
		"FAMILY HOME",
		Color("#e9d7b8"),
		Color("#a64f3c")
	)
	_draw_house(
		Rect2(Vector2(875.0, 145.0), Vector2(410.0, 280.0)),
		"IDERA COMMUNITY SECONDARY SCHOOL",
		Color("#f0e3bf"),
		Color("#34724a")
	)
	_draw_house(
		Rect2(Vector2(390.0, 680.0), Vector2(260.0, 165.0)),
		"MARKET SHOP",
		Color("#e9c986"),
		Color("#c96d3d")
	)
	_draw_house(
		Rect2(Vector2(1235.0, 350.0), Vector2(270.0, 170.0)),
		"COMMUNITY CLINIC",
		Color("#e8eee8"),
		Color("#39836a")
	)
	_draw_house(
		Rect2(Vector2(1230.0, 690.0), Vector2(270.0, 150.0)),
		"POLICE STATION",
		Color("#dbe4e7"),
		Color("#536b80")
	)
	_draw_house(
		Rect2(Vector2(850.0, 690.0), Vector2(280.0, 150.0)),
		"COMMUNITY HALL",
		Color("#efe3c6"),
		Color("#8d673e")
	)
	_draw_house(
		Rect2(Vector2(95.0, 710.0), Vector2(220.0, 135.0)),
		"FAMILY COMPOUND",
		Color("#ead6b0"),
		Color("#8c593d")
	)
	_draw_tree(Vector2(560.0, 300.0))
	_draw_tree(Vector2(1370.0, 260.0))
	_draw_tree(Vector2(1080.0, 640.0))
	_draw_tree(Vector2(360.0, 770.0))
	_draw_bus_stop(Vector2(600.0, 430.0))
	_draw_text("Main road", Vector2(560.0, 625.0), 15, Color("#fff2c7"))


func _draw_home() -> void:
	draw_rect(Rect2(Vector2.ZERO, MAP_SIZE), Color("#c7a77f"), true)
	draw_rect(Rect2(Vector2(135.0, 120.0), Vector2(1330.0, 700.0)), Color("#eadbc0"), true)
	draw_rect(Rect2(Vector2(135.0, 120.0), Vector2(1330.0, 28.0)), Color("#81553c"), true)
	draw_rect(Rect2(Vector2(135.0, 792.0), Vector2(1330.0, 28.0)), Color("#81553c"), true)
	draw_rect(Rect2(Vector2(135.0, 120.0), Vector2(28.0, 700.0)), Color("#81553c"), true)
	draw_rect(Rect2(Vector2(1437.0, 120.0), Vector2(28.0, 700.0)), Color("#81553c"), true)
	draw_line(Vector2(850.0, 150.0), Vector2(850.0, 785.0), Color("#c9b28d"), 7.0)
	draw_rect(Rect2(Vector2(300.0, 265.0), Vector2(260.0, 120.0)), Color("#72906d"), true)
	draw_rect(Rect2(Vector2(950.0, 250.0), Vector2(130.0, 150.0)), Color("#d8e0d5"), true)
	draw_rect(Rect2(Vector2(385.0, 655.0), Vector2(285.0, 70.0)), Color("#815d46"), true)
	draw_rect(Rect2(Vector2(1140.0, 620.0), Vector2(150.0, 105.0)), Color("#825941"), true)
	_draw_text("LIVING AREA", Vector2(330.0, 205.0), 18, Color("#5e4a39"))
	_draw_text("BEDROOM", Vector2(990.0, 205.0), 18, Color("#5e4a39"))
	_draw_text(
		"A simple family home · living area, bedroom and kitchen",
		Vector2(350.0, 770.0),
		20,
		Color("#544531")
	)


func _draw_schoolyard() -> void:
	draw_rect(Rect2(Vector2.ZERO, MAP_SIZE), Color("#82a65f"), true)
	draw_rect(Rect2(Vector2(350.0, 260.0), Vector2(1060.0, 430.0)), Color("#9fbd79"), true)
	draw_rect(Rect2(Vector2(820.0, 170.0), Vector2(510.0, 305.0)), Color("#eee1be"), true)
	draw_rect(Rect2(Vector2(820.0, 170.0), Vector2(510.0, 40.0)), Color("#367149"), true)
	draw_rect(Rect2(Vector2(890.0, 280.0), Vector2(370.0, 190.0)), Color("#d4c29f"), true)
	_draw_text("SCHOOL YARD", Vector2(440.0, 245.0), 23, Color("#f5f5df"))
	_draw_text("CLASSROOM BLOCK", Vector2(940.0, 250.0), 17, Color("#514832"))
	_draw_text(
		"Learn · meet friends · check the daily timetable",
		Vector2(380.0, 760.0),
		19,
		Color("#304d36")
	)


func _draw_classroom() -> void:
	draw_rect(Rect2(Vector2.ZERO, MAP_SIZE), Color("#b79b72"), true)
	draw_rect(Rect2(Vector2(120.0, 100.0), Vector2(1360.0, 710.0)), Color("#e8dec7"), true)
	draw_rect(Rect2(Vector2(500.0, 170.0), Vector2(640.0, 100.0)), Color("#345a43"), true)
	draw_rect(Rect2(Vector2(610.0, 430.0), Vector2(150.0, 70.0)), Color("#9d7754"), true)
	draw_rect(Rect2(Vector2(940.0, 430.0), Vector2(150.0, 70.0)), Color("#9d7754"), true)
	draw_rect(Rect2(Vector2(610.0, 620.0), Vector2(150.0, 70.0)), Color("#9d7754"), true)
	draw_rect(Rect2(Vector2(940.0, 620.0), Vector2(150.0, 70.0)), Color("#9d7754"), true)
	_draw_text("TODAY'S LESSON", Vector2(695.0, 230.0), 22, Color("#f4f0df"))
	_draw_text(
		"Mathematics · English · Computer Studies · Biology · Civic Education",
		Vector2(300.0, 770.0),
		18,
		Color("#514832")
	)


func _draw_market() -> void:
	draw_rect(Rect2(Vector2.ZERO, MAP_SIZE), Color("#cfb184"), true)
	draw_rect(Rect2(Vector2(130.0, 110.0), Vector2(1340.0, 700.0)), Color("#f0dfba"), true)
	draw_rect(Rect2(Vector2(300.0, 200.0), Vector2(1050.0, 95.0)), Color("#c16c43"), true)
	for shelf_x in [390.0, 710.0, 1030.0]:
		draw_rect(Rect2(Vector2(shelf_x, 360.0), Vector2(70.0, 280.0)), Color("#80583b"), true)
		draw_rect(
			Rect2(Vector2(shelf_x + 12.0, 390.0), Vector2(46.0, 42.0)), Color("#d89d45"), true
		)
		draw_rect(
			Rect2(Vector2(shelf_x + 12.0, 455.0), Vector2(46.0, 42.0)), Color("#679059"), true
		)
	_draw_text("NEIGHBOURHOOD SHOP", Vector2(620.0, 260.0), 22, Color("#fff4dc"))
	_draw_text(
		"Fresh snacks · bottled water · fair prices", Vector2(470.0, 755.0), 19, Color("#514832")
	)


func _draw_public_room(background: Color, heading: String, subtitle: String) -> void:
	draw_rect(Rect2(Vector2.ZERO, MAP_SIZE), Color("#c4ad86"), true)
	draw_rect(Rect2(Vector2(130.0, 110.0), Vector2(1340.0, 700.0)), background, true)
	draw_rect(Rect2(Vector2(130.0, 110.0), Vector2(1340.0, 52.0)), Color("#376b4d"), true)
	draw_rect(Rect2(Vector2(500.0, 350.0), Vector2(570.0, 120.0)), Color("#b89468"), true)
	_draw_text(heading, Vector2(585.0, 145.0), 24, Color("#fff9e8"))
	_draw_text(subtitle, Vector2(515.0, 720.0), 18, Color("#544c3c"))


func _draw_house(rect: Rect2, label: String, wall_color: Color, roof_color: Color) -> void:
	draw_rect(
		Rect2(rect.position + Vector2(9.0, 12.0), rect.size), Color(0.08, 0.13, 0.08, 0.24), true
	)
	draw_rect(rect, wall_color, true)
	draw_rect(Rect2(rect.position, Vector2(rect.size.x, 23.0)), roof_color, true)
	draw_rect(
		Rect2(rect.position + Vector2(20.0, 55.0), Vector2(42.0, 46.0)), Color("#91a8a0"), true
	)
	draw_rect(
		Rect2(rect.position + Vector2(rect.size.x - 72.0, 55.0), Vector2(42.0, 46.0)),
		Color("#91a8a0"),
		true
	)
	draw_rect(
		Rect2(rect.position + Vector2(rect.size.x * 0.46, rect.size.y - 66.0), Vector2(42.0, 66.0)),
		Color("#70513c"),
		true
	)
	_draw_text(
		label, rect.position + Vector2(0.0, rect.size.y + 25.0), 14, Color("#26382a"), rect.size.x
	)


func _draw_tree(tree_position: Vector2) -> void:
	draw_rect(
		Rect2(tree_position + Vector2(-6.0, 8.0), Vector2(12.0, 28.0)), Color("#72523a"), true
	)
	draw_circle(tree_position, 23.0, Color("#426f45"))
	draw_circle(tree_position + Vector2(-9.0, -8.0), 14.0, Color("#56864f"))


func _draw_bus_stop(stop_position: Vector2) -> void:
	draw_rect(Rect2(stop_position, Vector2(58.0, 50.0)), Color("#eadfbe"), true)
	draw_rect(Rect2(stop_position + Vector2(7.0, 8.0), Vector2(44.0, 34.0)), Color("#476c54"), true)
	_draw_text("BUS", stop_position + Vector2(-4.0, 72.0), 14, Color("#26382a"), 68.0)


func _draw_text(
	text_value: String, at: Vector2, font_size: int, color: Color, width: float = -1.0
) -> void:
	draw_string(
		ThemeDB.fallback_font, at, text_value, HORIZONTAL_ALIGNMENT_CENTER, width, font_size, color
	)
