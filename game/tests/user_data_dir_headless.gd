extends SceneTree
# Stage 44: prints the directory Godot uses for user:// in this project, then exits.
# It reads no save and writes nothing. tools/godot/run-godot-checks.sh uses the printed
# path to back up the local save files before any test runs.
#
# STATUS: WRITTEN, NOT EXECUTED (no Godot 4.7.2 binary in the Stage 44 sandbox).
#
# Run: godot --headless --path game --script res://tests/user_data_dir_headless.gd


func _init() -> void:
	print("USER_DATA_DIR: %s" % OS.get_user_data_dir())
	quit(0)
