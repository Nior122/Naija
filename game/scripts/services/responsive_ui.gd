extends Node
class_name ResponsiveUI

## Responsive UI Manager for Naija: One World
## Handles different screen sizes, safe areas, and platform-specific UI

# Screen information
var screen_size: Vector2 = Vector2.ZERO
var viewport_size: Vector2 = Vector2.ZERO
var safe_area: Rect2 = Rect2()
var is_mobile: bool = false
var is_touch: bool = false

# UI scale
var ui_scale: float = 1.0
var min_ui_scale: float = 0.75
var max_ui_scale: float = 1.5

# Safe area insets (pixels)
var safe_area_top: float = 0.0
var safe_area_bottom: float = 0.0
var safe_area_left: float = 0.0
var safe_area_right: float = 0.0

# Signals
signal screen_resized(new_size: Vector2)
signal safe_area_changed(safe_area: Rect2)
signal platform_changed(platform: String)

func _ready() -> void:
	"""Initialize responsive UI manager"""
	print("[ResponsiveUI] Initializing responsive UI system")
	
	# Detect platform
	_detect_platform()
	
	# Update screen information
	_update_screen_info()
	
	# Connect to viewport size changes
	get_tree().root.connect("size_changed", _on_viewport_resized)
	
	# Apply initial settings
	_apply_platform_defaults()

func _detect_platform() -> void:
	"""Detect the current platform"""
	var os_name = OS.get_name()
	
	is_mobile = os_name in ["Android", "iOS"]
	is_touch = is_mobile or OS.has_feature("web_android") or OS.has_feature("web_ios")
	
	print("[ResponsiveUI] Platform detected: ", os_name)
	print("[ResponsiveUI] Mobile: ", is_mobile, " | Touch: ", is_touch)

func _update_screen_info() -> void:
	"""Update screen and viewport information"""
	# Get viewport size
	viewport_size = get_viewport().get_visible_rect().size
	
	# Get screen size (may differ from viewport on mobile)
	screen_size = DisplayServer.screen_get_size()
	
	# Calculate safe area
	_calculate_safe_area()
	
	# Calculate UI scale
	_calculate_ui_scale()
	
	print("[ResponsiveUI] Screen: ", screen_size, " | Viewport: ", viewport_size)
	print("[ResponsiveUI] Safe area: ", safe_area, " | UI scale: ", ui_scale)

func _calculate_safe_area() -> void:
	"""Calculate safe area for notched devices"""
	# Godot 4.x provides safe area information
	if OS.has_feature("mobile") or OS.has_feature("web"):
		# Get screen safe area from DisplayServer
		var display_safe_area = DisplayServer.get_display_safe_area()
		
		if display_safe_area.size != Vector2.ZERO:
			safe_area = display_safe_area
			
			# Calculate insets
			safe_area_top = safe_area.position.y
			safe_area_bottom = screen_size.y - (safe_area.position.y + safe_area.size.y)
			safe_area_left = safe_area.position.x
			safe_area_right = screen_size.x - (safe_area.position.x + safe_area.size.x)
		else:
			# No safe area information, use full screen
			safe_area = Rect2(Vector2.ZERO, screen_size)
			safe_area_top = 0
			safe_area_bottom = 0
			safe_area_left = 0
			safe_area_right = 0
	else:
		# Desktop platforms typically don't have safe areas
		safe_area = Rect2(Vector2.ZERO, screen_size)
		safe_area_top = 0
		safe_area_bottom = 0
		safe_area_left = 0
		safe_area_right = 0

func _calculate_ui_scale() -> void:
	"""Calculate appropriate UI scale based on screen size and DPI"""
	# Base scale on viewport height
	var reference_height = 800.0  # Reference design height
	var height_ratio = viewport_size.y / reference_height
	
	# Clamp scale to reasonable range
	ui_scale = clamp(height_ratio, min_ui_scale, max_ui_scale)
	
	# Adjust for mobile devices (typically need larger UI)
	if is_mobile:
		ui_scale *= 1.2
	
	# Round to nearest 0.25 for cleaner scaling
	ui_scale = round(ui_scale * 4.0) / 4.0
	
	print("[ResponsiveUI] Calculated UI scale: ", ui_scale)

func _apply_platform_defaults() -> void:
	"""Apply platform-specific UI defaults"""
	if is_mobile:
		# Mobile defaults
		_apply_mobile_defaults()
	else:
		# Desktop defaults
		_apply_desktop_defaults()

func _apply_mobile_defaults() -> void:
	"""Apply mobile-specific defaults"""
	print("[ResponsiveUI] Applying mobile UI defaults")
	
	# Larger touch targets
	# This would be applied to button sizes, spacing, etc.
	
	# Simplified UI for smaller screens
	# Hide complex panels, use more compact layouts

func _apply_desktop_defaults() -> void:
	"""Apply desktop-specific defaults"""
	print("[ResponsiveUI] Applying desktop UI defaults")
	
	# Standard UI sizing
	# Full-featured interface with all panels visible

func _on_viewport_resized() -> void:
	"""Handle viewport resize"""
	print("[ResponsiveUI] Viewport resized")
	_update_screen_info()
	emit_signal("screen_resized", viewport_size)
	emit_signal("safe_area_changed", safe_area)

func get_safe_area() -> Rect2:
	"""Get the safe area rectangle"""
	return safe_area

func get_safe_area_insets() -> Dictionary:
	"""Get safe area insets in pixels"""
	return {
		"top": safe_area_top,
		"bottom": safe_area_bottom,
		"left": safe_area_left,
		"right": safe_area_right
	}

func get_ui_scale() -> float:
	"""Get the current UI scale factor"""
	return ui_scale

func is_mobile_platform() -> bool:
	"""Check if running on mobile platform"""
	return is_mobile

func is_touch_platform() -> bool:
	"""Check if platform uses touch input"""
	return is_touch

func apply_safe_area_to_control(control: Control) -> void:
	"""Apply safe area margins to a control"""
	if not control:
		return
	
	# Set anchors to full rect
	control.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	
	# Apply safe area as offsets
	control.offset_top = safe_area_top
	control.offset_bottom = -safe_area_bottom
	control.offset_left = safe_area_left
	control.offset_right = -safe_area_right

func get_touch_target_size() -> Vector2:
	"""Get recommended touch target size"""
	# Minimum touch target is 44x44 points (Apple HIG)
	# We use 48x48 for better accessibility
	var base_size = Vector2(48, 48)
	return base_size * ui_scale

func get_font_size(base_size: int) -> int:
	"""Get scaled font size"""
	return int(base_size * ui_scale)

func get_adaptive_layout_config() -> Dictionary:
	"""Get layout configuration based on screen size"""
	var width = viewport_size.x
	
	if width < 600:
		# Phone portrait
		return {
			"layout": "compact",
			"show_side_panels": false,
			"show_bottom_bar": true,
			"button_size": get_touch_target_size(),
			"font_scale": 1.0
		}
	elif width < 1024:
		# Phone landscape or tablet portrait
		return {
			"layout": "medium",
			"show_side_panels": false,
			"show_bottom_bar": true,
			"button_size": get_touch_target_size(),
			"font_scale": 1.1
		}
	else:
		# Tablet landscape or desktop
		return {
			"layout": "full",
			"show_side_panels": true,
			"show_bottom_bar": false,
			"button_size": Vector2(32, 32) * ui_scale,
			"font_scale": 1.0
		}

func get_platform_name() -> String:
	"""Get the current platform name"""
	return OS.get_name()

func get_device_type() -> String:
	"""Get the device type (mobile, tablet, desktop)"""
	if is_mobile:
		var width = viewport_size.x
		if width < 600:
			return "phone"
		else:
			return "tablet"
	else:
		return "desktop"
