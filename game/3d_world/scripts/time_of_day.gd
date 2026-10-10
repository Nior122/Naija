extends Node
class_name TimeOfDay

## Time of Day System for Naija: One World
## Manages day/night cycle and connects to the existing WorldClock system

# Time settings
@export var time_scale: float = 60.0  # 1 real second = 60 game seconds
@export var start_time: float = 8.0   # Start at 8 AM
@export var day_length_minutes: float = 24.0 * 60.0  # 24 hours in game minutes

# Time state
var current_time: float = 8.0  # Hours (0-24)
var day_count: int = 0

# References
var sun_light: DirectionalLight3D = null
var world_environment: WorldEnvironment = null

# Signals
signal time_changed(new_time: float)
signal hour_changed(hour: int)
signal day_changed(day: int)
signal period_changed(period: String)  # "dawn", "day", "dusk", "night"

func _ready() -> void:
	"""Initialize the time system"""
	print("[TimeOfDay] Initializing time system")
	
	# Find references
	if get_parent():
		sun_light = get_parent().get_node_or_null("DirectionalLight3D") as DirectionalLight3D
		world_environment = get_parent().get_node_or_null("WorldEnvironment") as WorldEnvironment
	
	# Set initial time
	set_time(start_time)

func _process(delta: float) -> void:
	"""Update time each frame"""
	# Advance time
	var game_seconds = delta * time_scale
	var game_hours = game_seconds / 3600.0
	
	var old_hour = int(current_time)
	current_time += game_hours
	
	# Check for hour change
	var new_hour = int(current_time)
	if new_hour != old_hour:
		emit_signal("hour_changed", new_hour)
	
	# Check for day change
	if current_time >= 24.0:
		current_time -= 24.0
		day_count += 1
		emit_signal("day_changed", day_count)
	
	# Update lighting
	_update_lighting()
	
	# Emit time changed signal
	emit_signal("time_changed", current_time)

func set_time(hours: float) -> void:
	"""Set the current time (0-24)"""
	current_time = clamp(hours, 0.0, 24.0)
	_update_lighting()
	emit_signal("time_changed", current_time)

func _update_lighting() -> void:
	"""Update lighting based on time of day"""
	if not sun_light:
		return
	
	# Calculate sun angle based on time
	# 6 AM = sunrise (east), 12 PM = noon (overhead), 6 PM = sunset (west), 12 AM = midnight (below)
	var sun_angle = ((current_time - 6.0) / 24.0) * 360.0
	var sun_pitch = -cos(deg_to_rad(sun_angle)) * 90.0
	var sun_yaw = sin(deg_to_rad(sun_angle)) * 180.0
	
	# Rotate sun
	sun_light.rotation_degrees = Vector3(sun_pitch, sun_yaw, 0)
	
	# Adjust light color and intensity based on time
	var period = get_current_period()
	
	match period:
		"dawn":
			sun_light.light_color = Color(1.0, 0.8, 0.6)  # Warm orange
			sun_light.light_energy = 0.7
			_set_ambient_light(Color(0.5, 0.4, 0.5), 0.3)
		"day":
			sun_light.light_color = Color(1.0, 0.95, 0.9)  # Bright white
			sun_light.light_energy = 1.0
			_set_ambient_light(Color(0.6, 0.65, 0.75), 0.4)
		"dusk":
			sun_light.light_color = Color(1.0, 0.6, 0.4)  # Deep orange
			sun_light.light_energy = 0.6
			_set_ambient_light(Color(0.5, 0.4, 0.5), 0.3)
		"night":
			sun_light.light_color = Color(0.4, 0.5, 0.7)  # Cool blue
			sun_light.light_energy = 0.2
			_set_ambient_light(Color(0.2, 0.25, 0.35), 0.2)

func _set_ambient_light(color: Color, energy: float) -> void:
	"""Set ambient light color and energy"""
	if world_environment and world_environment.environment:
		world_environment.environment.ambient_light_color = color
		world_environment.environment.ambient_light_energy = energy

func get_current_period() -> String:
	"""Get the current time period"""
	if current_time >= 5.0 and current_time < 7.0:
		return "dawn"
	elif current_time >= 7.0 and current_time < 18.0:
		return "day"
	elif current_time >= 18.0 and current_time < 20.0:
		return "dusk"
	else:
		return "night"

func get_time_string() -> String:
	"""Get formatted time string"""
	var hours = int(current_time)
	var minutes = int((current_time - hours) * 60)
	return "%02d:%02d" % [hours, minutes]

func is_daytime() -> bool:
	"""Check if it's currently daytime"""
	var period = get_current_period()
	return period == "day" or period == "dawn" or period == "dusk"

func sync_with_world_clock(world_clock_data: Dictionary) -> void:
	"""Sync with the existing WorldClock system from the 2D game"""
	if world_clock_data.has("current_time"):
		# Convert from WorldClock format to TimeOfDay format
		# WorldClock uses game minutes, TimeOfDay uses hours
		var game_minutes = world_clock_data.current_time
		set_time(game_minutes / 60.0)
	
	if world_clock_data.has("day_count"):
		day_count = world_clock_data.day_count
