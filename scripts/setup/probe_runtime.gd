extends SceneTree

func _initialize() -> void:
	var args := OS.get_cmdline_user_args()
	if args.size() != 2 or args[0] != "--dsh-gamedev-probe-id":
		push_error("Runtime probe requires its invocation identity")
		quit(2)
		return
	var result := {
		"id": args[1],
		"engine": Engine.get_version_info()["string"],
		"managed": ClassDB.class_exists("CSharpScript"),
		"userData": OS.get_user_data_dir(),
	}
	print("DSH_GAMEDEV_RUNTIME_READY=" + JSON.stringify(result))
	quit(0)
