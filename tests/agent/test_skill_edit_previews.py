"""Skill batches expose actual on-disk changes, not their requested operations."""
import json

import pytest

from agent.display import capture_local_edit_snapshot, extract_edit_diff


SKILL = "---\nname: probe\ndescription: Use when testing edit previews.\n---\n# Probe\nOld rule.\n"


@pytest.fixture
def skills(tmp_path, monkeypatch):
    from tools import skill_manager_tool as smt

    root = tmp_path / "skills"
    root.mkdir()
    monkeypatch.setattr(smt, "SKILLS_DIR", root)
    monkeypatch.setattr("agent.skill_utils.get_all_skills_dirs", lambda: [root])
    monkeypatch.setattr(smt, "_resolve_skill_dir", lambda name, category=None: root / (category or "") / name)
    monkeypatch.setenv("HERMES_YOLO_MODE", "1")
    # A linked checkout's Git metadata lives outside the isolated test home.
    monkeypatch.setattr("hermes_cli._early_recovery.restore_interrupted_pull", lambda root: False)
    return root, smt


def test_create_batch_captures_skill_and_support_files_before_they_exist(skills):
    root, smt = skills
    args = {"operations": [
        {"action": "create", "name": "probe", "category": "testing", "content": SKILL},
        {"action": "write_file", "name": "probe", "file_path": "references/guide.md", "file_content": "Guide.\n"},
        {"action": "write_file", "name": "probe", "file_path": "scripts/check.py", "file_content": "print('ok')\n"},
    ]}
    snapshot = capture_local_edit_snapshot("skill_manage", args)
    assert snapshot is not None
    assert set(snapshot.before) == {str(root / "testing/probe" / p) for p in (
        "SKILL.md", "references/guide.md", "scripts/check.py")}
    result = smt.skill_manage(action="", name="", operations=args["operations"])
    assert json.loads(result)["success"], result
    diff = extract_edit_diff("skill_manage", result, function_args=args, snapshot=snapshot)
    assert diff is not None
    for relative in ("SKILL.md", "references/guide.md", "scripts/check.py"):
        assert f"+++ b/{root / 'testing/probe' / relative}" in diff
    assert "+Guide." in diff and "+print('ok')" in diff


@pytest.mark.parametrize("surface", ["desktop", "local_viewer"])
def test_skill_preview_keeps_every_file_as_parseable_durable_diff(skills, monkeypatch, surface):
    from types import SimpleNamespace

    _root, smt = skills
    args = {"operations": [{"action": "create", "name": "probe", "content": SKILL}] + [
        {"action": "write_file", "name": "probe", "file_path": f"references/guide-{i}.md",
         "file_content": f"Guide {i}.\n"} for i in range(8)
    ]}
    if surface == "desktop":
        import pm.environments as pmenv

        # Importing the gateway activates the checkout's dependency payload against the
        # install home; the runner already supplied that environment.
        monkeypatch.setattr(pmenv, "activate_dependencies", lambda root: None)
        import tui_gateway.server as progress

        monkeypatch.setitem(progress._sessions, "skill-preview", {})
        progress._on_tool_start("skill-preview", "edit", "skill_manage", args)
    else:
        from gateway.local_viewer_events import note_tool_start

        turn = SimpleNamespace(_ctx=SimpleNamespace(session_id="skill-preview"))
        note_tool_start(turn, "edit", "skill_manage", args)
    result = smt.skill_manage(action="", name="", operations=args["operations"])
    assert json.loads(result)["success"], result
    if surface == "desktop":
        metadata = progress._prepare_tool_result_metadata("skill-preview", "edit", "skill_manage", args, result)
        diff = metadata["tool_result_metadata"]["inline_diff"]
    else:
        from gateway.local_viewer_events import complete_fields

        diff = complete_fields(turn, "edit", "skill_manage", args, result)["inline_diff"]
    assert diff.startswith("--- a/")
    assert diff.count("+++ b/") == 9
    for i in range(8):
        assert f"+Guide {i}." in diff


def test_supporting_file_without_trailing_newline_has_separate_diff_lines(skills):
    root, smt = skills
    created = smt.skill_manage(action="create", name="probe", content=SKILL)
    assert json.loads(created)["success"]
    target = root / "probe/scripts/check.py"
    target.parent.mkdir()
    target.write_text("old", encoding="utf-8")
    args = {"operations": [{"action": "patch", "name": "probe", "file_path": "scripts/check.py",
                             "old_string": "old", "new_string": "new"}]}
    snapshot = capture_local_edit_snapshot("skill_manage", args)
    result = smt.skill_manage(action="", name="", operations=args["operations"])
    assert json.loads(result)["success"], result
    diff = extract_edit_diff("skill_manage", result, function_args=args, snapshot=snapshot)
    assert diff is not None
    assert "-old\n" in diff and "+new\n" in diff


@pytest.mark.parametrize("mode", ["patch-chain", "remove", "failed", "noop"])
def test_skill_preview_reports_only_landed_net_changes(skills, mode):
    root, smt = skills
    assert json.loads(smt.skill_manage(action="create", name="probe", content=SKILL))["success"]
    guide = root / "probe/references/guide.md"
    guide.parent.mkdir()
    guide.write_text("Guide.\n", encoding="utf-8")
    ops = [{"action": "patch", "name": "probe", "old_string": "Old rule.", "new_string": "New rule."}]
    if mode == "patch-chain":
        ops.append({"action": "patch", "name": "probe", "old_string": "New rule.", "new_string": "Final rule."})
    elif mode == "remove":
        ops = [{"action": "remove_file", "name": "probe", "file_path": "references/guide.md"}]
    elif mode == "failed":
        ops.append({"action": "patch", "name": "probe", "old_string": "does not exist", "new_string": "bad"})
    else:
        ops.append({"action": "patch", "name": "probe", "old_string": "New rule.", "new_string": "Old rule."})
    args = {"operations": ops}
    snapshot = capture_local_edit_snapshot("skill_manage", args)
    result = smt.skill_manage(action="", name="", operations=ops)
    assert json.loads(result)["success"] == (mode != "failed"), result
    diff = extract_edit_diff("skill_manage", result, function_args=args, snapshot=snapshot)
    if mode in {"failed", "noop"}:
        assert diff is None
    else:
        assert diff is not None
        if mode == "remove":
            assert "-Guide." in diff
        else:
            assert "+Final rule." in diff and "+New rule." not in diff
            assert diff.count("+++ b/") == 1
