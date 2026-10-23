extends SceneTree

func _init() -> void:
	print("DSH_ENGINE_VERSION " + JSON.stringify(Engine.get_version_info()))
	quit()
