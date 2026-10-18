extends Node
class_name TouchControls

## Touch Controls Manager for Naija: One World
## Provides touch-based input for mobile devices

# Touch state
var touch_enabled: bool = false
var joystick_visible: bool = false
var joystick_position: Vector2 = Vector2.ZERO
var joystick_radius: float = 100.0
var joystick_deadzone: float = 15.0

# Movement
var move_direction: Vector2 = Vector2.ZERO
var move_magnitude: float = 0.0

# Action buttons
var action_buttons: Dictionary = {}
var active_touches: Dictionary = {}

# Virtual joystick
var joystick_base: ColorRect = null
var joystick_knob: ColorRect = null
var joystick_touch_id: int = -1

# Signals
signal move_input(direction: Vector2, magnitude: float)
signal action_pressed(action_name: String)
signal action_released(action_name: String)
signal touch_started(touch_id: int, position: Vector2)
signal touch_ended(touch_id: int, position: Vector2)

func _ready() -> void:
	"""Initialize touch controls"""
	print("[TouchControls] Initializing touch control system")
	
	# Check if touch is available
	touch_enabled = OS.has_feature("mobile") or OS.has_feature("web")
	
	if touch_enabled:
		print("[TouchControls] Touch input detected - enabling touch controls")
		_create_virtual_joystick()
		set_process_input(true)
	else:
		print("[TouchControls] No touch input - touch controls disabled")

func _create_virtual_joystick() -> void:
	"""Create virtual joystick UI"""
	# Create joystick base
	joystick_base = ColorRect.new()
	joystick_base.color = Color(1, 1, 1, 0.2)
	joystick_base.size = Vector2(joystick_radius * 2, joystick_radius * 2)
	joystick_base.position = Vector2(100, 600)  # Bottom-left corner
	
	# Create joystick knob
	joystick_knob = ColorRect.new()
	joystick_knob.color = Color(1, 1, 1, 0.5)
	joystick_knob.size = Vector2(60, 60)
	joystick_knob.position = joystick_base.position + Vector2(joystick_radius - 30, joystick_radius - 30)
	
	# Add to UI layer
	var canvas = CanvasLayer.new()
	canvas.layer = 100  # Top layer
	canvas.add_child(joystick_base)
	canvas.add_child(joystick_knob)
	add_child(canvas)
	
	joystick_visible = true
	print("[TouchControls] Virtual joystick created")

func _input(event: InputEvent) -> void:
	"""Handle touch input events"""
	if not touch_enabled:
		return
	
	# Handle screen touch
	if event is InputEventScreenTouch:
		_handle_screen_touch(event)
	
	# Handle screen drag
	elif event is InputEventScreenDrag:
		_handle_screen_drag(event)

func _handle_screen_touch(event: InputEventScreenTouch) -> void:
	"""Handle screen touch (press/release)"""
	if event.pressed:
		# Touch started
		active_touches[event.index] = event.position
		emit_signal("touch_started", event.index, event.position)
		
		# Check if touch is on joystick
		if _is_point_in_joystick(event.position):
			joystick_touch_id = event.index
			joystick_position = event.position
	else:
		# Touch ended
		if event.index in active_touches:
			active_touches.erase(event.index)
			emit_signal("touch_ended", event.index, active_touches.get(event.index, Vector2.ZERO))
		
		# Check if joystick touch ended
		if event.index == joystick_touch_id:
			joystick_touch_id = -1
			_reset_joystick()

func _handle_screen_drag(event: InputEventScreenDrag) -> void:
	"""Handle screen drag (movement)"""
	if event.index in active_touches:
		active_touches[event.index] = event.position
	
	# Update joystick if this is the joystick touch
	if event.index == joystick_touch_id:
		_update_joystick(event.position)

func _is_point_in_joystick(point: Vector2) -> bool:
	"""Check if a point is within the joystick area"""
	if not joystick_base:
		return false
	
	var joystick_center = joystick_base.position + joystick_base.size / 2
	var distance = point.distance_to(joystick_center)
	return distance <= joystick_radius

func _update_joystick(touch_position: Vector2) -> void:
	"""Update joystick position based on touch"""
	if not joystick_base or not joystick_knob:
		return
	
	var joystick_center = joystick_base.position + joystick_base.size / 2
	var offset = touch_position - joystick_center
	
	# Clamp to joystick radius
	var distance = offset.length()
	if distance > joystick_radius:
		offset = offset.normalized() * joystick_radius
	
	# Update knob position
	joystick_knob.position = joystick_center + offset - joystick_knob.size / 2
	
	# Calculate movement direction and magnitude
	if distance > joystick_deadzone:
		move_direction = offset.normalized()
		move_magnitude = (distance - joystick_deadzone) / (joystick_radius - joystick_deadzone)
		move_magnitude = clamp(move_magnitude, 0.0, 1.0)
	else:
		move_direction = Vector2.ZERO
		move_magnitude = 0.0
	
	# Emit movement signal
	emit_signal("move_input", move_direction, move_magnitude)

func _reset_joystick() -> void:
	"""Reset joystick to center position"""
	if not joystick_base or not joystick_knob:
		return
	
	var joystick_center = joystick_base.position + joystick_base.size / 2
	joystick_knob.position = joystick_center - joystick_knob.size / 2
	
	move_direction = Vector2.ZERO
	move_magnitude = 0.0
	
	emit_signal("move_input", Vector2.ZERO, 0.0)

func create_action_button(action_name: String, position: Vector2, size: Vector2 = Vector2(80, 80)) -> void:
	"""Create a virtual action button"""
	var button = Button.new()
	button.text = action_name.capitalize()
	button.position = position
	button.size = size
	
	# Connect button signals
	button.connect("pressed", _on_action_button_pressed.bind(action_name))
	button.connect("released", _on_action_button_released.bind(action_name))
	
	# Add to UI layer
	var canvas = get_node_or_null("CanvasLayer")
	if not canvas:
		canvas = CanvasLayer.new()
		canvas.layer = 100
		add_child(canvas)
	
	canvas.add_child(button)
	
	action_buttons[action_name] = button
	print("[TouchControls] Created action button: ", action_name)

func _on_action_button_pressed(action_name: String) -> void:
	"""Handle action button press"""
	emit_signal("action_pressed", action_name)

func _on_action_button_released(action_name: String) -> void:
	"""Handle action button release"""
	emit_signal("action_released", action_name)

func get_move_direction() -> Vector2:
	"""Get current movement direction from joystick"""
	return move_direction

func get_move_magnitude() -> float:
	"""Get current movement magnitude from joystick"""
	return move_magnitude

func is_touch_enabled() -> bool:
	"""Check if touch controls are enabled"""
	return touch_enabled

func show_joystick(show: bool) -> void:
	"""Show or hide the virtual joystick"""
	if joystick_base:
		joystick_base.visible = show
	if joystick_knob:
		joystick_knob.visible = show
	joystick_visible = show

func set_joystick_position(position: Vector2) -> void:
	"""Set the joystick position"""
	if joystick_base:
		joystick_base.position = position
		_reset_joystick()

func get_touch_count() -> int:
	"""Get the number of active touches"""
	return active_touches.size()

func is_touching() -> bool:
	"""Check if any touch is active"""
	return active_touches.size() > 0
