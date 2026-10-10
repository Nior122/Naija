extends Node
class_name GraphicsQuality

## Graphics Quality Manager for Naija: One World
## Provides quality profiles and performance monitoring

# Quality profiles
enum QualityProfile {
	LOW,
	MEDIUM,
	HIGH,
	AUTOMATIC
}

# Current quality settings
var current_profile: QualityProfile = QualityProfile.MEDIUM
var auto_quality_enabled: bool = false
var target_fps: int = 30
var current_fps: float = 0.0
var frame_time_ms: float = 0.0

# Performance monitoring
var fps_samples: Array[float] = []
var max_samples: int = 60
var performance_warning_threshold: float = 20.0  # FPS below this triggers warning

# Quality settings (applied to renderer)
var render_scale: float = 1.0
var shadow_quality: int = 0  # 0=off, 1=low, 2=medium, 3=high
var view_distance: float = 100.0
var texture_quality: int = 1  # 0=low, 1=medium, 2=high
var effects_quality: int = 1  # 0=off, 1=low, 2=high
var vsync_enabled: bool = true

# Signals
signal quality_changed(profile: QualityProfile)
signal performance_warning(low_fps: bool)
signal fps_updated(fps: float)

func _ready() -> void:
	"""Initialize graphics quality manager"""
	print("[GraphicsQuality] Initializing quality manager")
	
	# Detect platform and set default quality
	_detect_platform_defaults()
	
	# Apply initial quality settings
	apply_quality_profile(current_profile)
	
	# Start performance monitoring
	set_process(true)

func _process(delta: float) -> void:
	"""Monitor performance and adjust quality if needed"""
	# Calculate FPS
	if delta > 0:
		current_fps = 1.0 / delta
		frame_time_ms = delta * 1000.0
		
		# Store FPS sample
		fps_samples.append(current_fps)
		if fps_samples.size() > max_samples:
			fps_samples.pop_front()
		
		# Emit FPS update
		emit_signal("fps_updated", current_fps)
		
		# Check for performance warning
		var avg_fps = _get_average_fps()
		if avg_fps < performance_warning_threshold:
			emit_signal("performance_warning", true)
		
		# Auto-adjust quality if enabled
		if auto_quality_enabled:
			_auto_adjust_quality(avg_fps)

func _detect_platform_defaults() -> void:
	"""Detect platform and set appropriate default quality"""
	var os_name = OS.get_name()
	
	match os_name:
		"Android", "iOS":
			# Mobile devices - start with low quality
			current_profile = QualityProfile.LOW
			target_fps = 30
			print("[GraphicsQuality] Mobile platform detected - defaulting to LOW quality")
		"Web":
			# Web browsers - medium quality
			current_profile = QualityProfile.MEDIUM
			target_fps = 30
			print("[GraphicsQuality] Web platform detected - defaulting to MEDIUM quality")
		_:
			# Desktop - high quality
			current_profile = QualityProfile.HIGH
			target_fps = 60
			print("[GraphicsQuality] Desktop platform detected - defaulting to HIGH quality")

func apply_quality_profile(profile: QualityProfile) -> void:
	"""Apply a quality profile to the renderer"""
	current_profile = profile
	
	match profile:
		QualityProfile.LOW:
			render_scale = 0.75
			shadow_quality = 0
			view_distance = 50.0
			texture_quality = 0
			effects_quality = 0
			vsync_enabled = true
			target_fps = 30
			print("[GraphicsQuality] Applied LOW quality profile")
			
		QualityProfile.MEDIUM:
			render_scale = 1.0
			shadow_quality = 1
			view_distance = 100.0
			texture_quality = 1
			effects_quality = 1
			vsync_enabled = true
			target_fps = 30
			print("[GraphicsQuality] Applied MEDIUM quality profile")
			
		QualityProfile.HIGH:
			render_scale = 1.0
			shadow_quality = 2
			view_distance = 200.0
			texture_quality = 2
			effects_quality = 2
			vsync_enabled = true
			target_fps = 60
			print("[GraphicsQuality] Applied HIGH quality profile")
			
		QualityProfile.AUTOMATIC:
			auto_quality_enabled = true
			print("[GraphicsQuality] Enabled AUTOMATIC quality adjustment")
	
	# Apply settings to renderer
	_apply_renderer_settings()
	
	# Emit signal
	emit_signal("quality_changed", profile)

func _apply_renderer_settings() -> void:
	"""Apply quality settings to the Godot renderer"""
	# Note: Some settings require Godot 4.x specific APIs
	# This is a simplified implementation that works with GL Compatibility
	
	# Set VSync
	DisplayServer.window_set_vsync_mode(
		DisplayServer.VSYNC_ENABLED if vsync_enabled else DisplayServer.VSYNC_DISABLED
	)
	
	# Set target FPS
	Engine.max_fps = target_fps
	
	# Note: Other settings like render scale, shadows, etc.
	# would be applied to specific Viewport and WorldEnvironment nodes
	# This is handled in world_3d_controller.gd

func _auto_adjust_quality(average_fps: float) -> void:
	"""Automatically adjust quality based on performance"""
	if average_fps < target_fps * 0.7:
		# Performance is poor, reduce quality
		if current_profile == QualityProfile.HIGH:
			apply_quality_profile(QualityProfile.MEDIUM)
		elif current_profile == QualityProfile.MEDIUM:
			apply_quality_profile(QualityProfile.LOW)
	elif average_fps > target_fps * 1.2:
		# Performance is good, can increase quality
		if current_profile == QualityProfile.LOW:
			apply_quality_profile(QualityProfile.MEDIUM)
		elif current_profile == QualityProfile.MEDIUM:
			apply_quality_profile(QualityProfile.HIGH)

func _get_average_fps() -> float:
	"""Calculate average FPS from samples"""
	if fps_samples.is_empty():
		return 0.0
	
	var sum: float = 0.0
	for fps in fps_samples:
		sum += fps
	
	return sum / fps_samples.size()

func get_current_profile() -> QualityProfile:
	"""Get the current quality profile"""
	return current_profile

func get_current_fps() -> float:
	"""Get the current FPS"""
	return current_fps

func get_frame_time_ms() -> float:
	"""Get the current frame time in milliseconds"""
	return frame_time_ms

func get_profile_name(profile: QualityProfile) -> String:
	"""Get the name of a quality profile"""
	match profile:
		QualityProfile.LOW:
			return "Low"
		QualityProfile.MEDIUM:
			return "Medium"
		QualityProfile.HIGH:
			return "High"
		QualityProfile.AUTOMATIC:
			return "Automatic"
	return "Unknown"

func set_target_fps(fps: int) -> void:
	"""Set the target frame rate"""
	target_fps = fps
	Engine.max_fps = target_fps
	print("[GraphicsQuality] Target FPS set to ", fps)

func enable_performance_monitoring(enable: bool) -> void:
	"""Enable or disable performance monitoring"""
	set_process(enable)
	print("[GraphicsQuality] Performance monitoring ", "enabled" if enable else "disabled")

func get_performance_report() -> Dictionary:
	"""Get a performance report"""
	return {
		"profile": get_profile_name(current_profile),
		"fps": current_fps,
		"avg_fps": _get_average_fps(),
		"frame_time_ms": frame_time_ms,
		"target_fps": target_fps,
		"render_scale": render_scale,
		"shadow_quality": shadow_quality,
		"view_distance": view_distance,
		"texture_quality": texture_quality,
		"effects_quality": effects_quality,
		"vsync": vsync_enabled,
		"auto_quality": auto_quality_enabled
	}
