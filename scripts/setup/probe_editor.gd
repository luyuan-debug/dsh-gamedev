@tool
extends SceneTree

const TIMEOUT_MS := 20_000
const SETTLE_MS := 500

func _initialize() -> void:
	call_deferred("_probe")

func _probe() -> void:
	# EditorPaths is exposed through EditorInterface, not Engine's singleton list.
	# A --editor --script SceneTree starts before the editor's first filesystem scan.
	# Keep the event loop running until that scan has settled before probing or quitting.
	var deadline := Time.get_ticks_msec() + TIMEOUT_MS
	var settled_since := 0
	while true:
		await process_frame
		if Time.get_ticks_msec() >= deadline:
			push_error("Editor startup did not settle before the paths probe timeout")
			quit(2)
			return
		var filesystem := EditorInterface.get_resource_filesystem()
		var control := EditorInterface.get_base_control()
		if filesystem == null or control == null or not control.is_inside_tree() or filesystem.is_scanning():
			settled_since = 0
			continue
		if settled_since == 0:
			settled_since = Time.get_ticks_msec()
		if Time.get_ticks_msec() - settled_since >= SETTLE_MS:
			break
	var paths := EditorInterface.get_editor_paths()
	if paths == null:
		push_error("EditorInterface did not expose editor paths")
		quit(2)
		return
	var result := {
		"data": paths.get_data_dir(),
		"config": paths.get_config_dir(),
		"cache": paths.get_cache_dir(),
		"selfContained": paths.is_self_contained(),
		"marker": paths.get_self_contained_file(),
	}
	print("DSH_GAMEDEV_EDITOR_PATHS=" + JSON.stringify(result))
	quit(0)
