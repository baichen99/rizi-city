"""Offline regression tests: temporary Git remotes and fake agent/GitHub commands."""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

import yaml

SOURCE = Path(__file__).resolve().parents[1]


class PatrolScriptTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.base = Path(self.tmp.name)
        self.repo = self.base / "repo"
        self.repo.mkdir()
        self.remote = self.base / "remote.git"
        self.run_git("init", "--bare", str(self.remote))
        self.run_git("init", "-b", "main")
        self.run_git("config", "user.name", "Patrol Test")
        self.run_git("config", "user.email", "test@example.invalid")
        for directory in ["scripts", "agent", "data/cities", "site/data"]:
            (self.repo / directory).mkdir(parents=True, exist_ok=True)
        shutil.copyfile(SOURCE / "scripts/patrol.sh", self.repo / "scripts/patrol.sh")
        for name in ["validate.py", "build.py"]:
            (self.repo / "scripts" / name).write_text("# Test stub: no network or generated changes.\n")
        (self.repo / "agent/patrol.md").write_text("Test instructions\n")
        city = {"city": "Test", "province": "Test", "maintainers": [], "last_patrol": None,
                "civil_service": {"exam_schedule": "old"}, "living": {"value": 1}, "changelog": []}
        for name in ["testcity", "othercity"]:
            (self.repo / f"data/cities/{name}.yaml").write_text(yaml.safe_dump(city))
        (self.repo / "site/data/cities.json").write_text("{}\n")
        (self.repo / "README.md").write_text("Test\n")
        (self.repo / "other.txt").write_text("unchanged\n")
        self.run_git("add", ".")
        self.run_git("commit", "-m", "test baseline")
        self.run_git("remote", "add", "origin", str(self.remote))
        self.run_git("push", "origin", "main")
        self.bin = self.base / "bin"
        self.bin.mkdir()
        agent = self.bin / "claude"
        agent.write_text('''#!/usr/bin/env python3
import os, pathlib, subprocess, sys, yaml
action = os.environ.get("FAKE_ACTION", "normal")
if action == "fail": sys.exit(9)
path = pathlib.Path("data/cities/testcity.yaml")
city = yaml.safe_load(path.read_text())
if action not in {"nochange", "missing_scan"}: city["civil_service"]["exam_schedule"] = "new"
if action == "missing_scan": city["subsidy_scan"] = {"notes": "added by test"}
if action == "outscope": city["living"]["value"] = 2
if action == "maintainers": city["maintainers"] = ["unexpected"]
if action == "last_patrol": city["last_patrol"] = "2026-11-09"
if action == "unrelated": pathlib.Path("other.txt").write_text("changed")
if action == "othercity": pathlib.Path("data/cities/othercity.yaml").write_text(yaml.safe_dump(city))
if action == "untracked": pathlib.Path("data/cities/new.txt").write_text("unrelated")
if action == "script": pathlib.Path("scripts/validate.py").write_text('from pathlib import Path; Path("executed.txt").write_text("should never run")')
if action == "readme": pathlib.Path("README.md").write_text("unrelated prose")
if action == "json": pathlib.Path("site/data/cities.json").write_text('{"unrelated": true}')
path.write_text(yaml.safe_dump(city))
if action == "staged": subprocess.run(["git", "add", "other.txt"], check=True)
if action == "commit":
    subprocess.run(["git", "add", str(path)], check=True)
    subprocess.run(["git", "commit", "-m", "unexpected agent commit"], check=True)
print("## 巡检小结：testcity\\nAgent: Claude Code")
''')
        agent.chmod(0o755)
        gh = self.bin / "gh"
        gh.write_text('''#!/usr/bin/env python3
import os, pathlib, sys
with pathlib.Path(os.environ["GH_TEST_LOG"]).open("a") as f: f.write(" ".join(sys.argv[1:]) + "\\n")
if sys.argv[1:3] == ["api", "user"]: print("test-user")
elif ".permissions.push" in sys.argv: print("true")
elif sys.argv[1:3] == ["pr", "create"]: print("test PR created")
else: sys.exit("Unexpected gh call")
''')
        gh.chmod(0o755)
        self.gh_log = self.base / "gh.log"

    def run_git(self, *args):
        return subprocess.run(["git", *args], cwd=self.repo, check=True,
                              stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True).stdout.strip()

    def patrol(self, action="normal", city="testcity", **overrides):
        env = dict(os.environ, PATH=f"{self.bin}:{os.environ['PATH']}", AGENT="claude",
                   SCOPE="civil_service", FAKE_ACTION=action, GH_TEST_LOG=str(self.gh_log))
        env.pop("NO_PR", None)
        env.update(overrides)
        return subprocess.run(["bash", "scripts/patrol.sh", city], cwd=self.repo, env=env,
                              capture_output=True, text=True)

    def test_same_day_runs_use_distinct_branches(self):
        result = self.patrol()
        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
        first = self.run_git("branch", "--show-current")
        result = self.patrol()
        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
        second = self.run_git("branch", "--show-current")
        self.assertNotEqual(first, second)
        self.assertTrue(first.startswith("patrol/testcity-civil_service-"))
        self.assertEqual(len(self.run_git("ls-remote", "--heads", "origin", "patrol/*").splitlines()), 2)
        self.assertEqual(self.run_git("show", "--format=", "--name-only", "HEAD"), "data/cities/testcity.yaml")

    def test_existing_local_branch_is_not_reset(self):
        branch = "patrol/testcity-2026-11-09"
        self.run_git("branch", branch)
        before = self.run_git("rev-parse", branch)
        self.assertEqual(self.patrol().returncode, 0)
        self.assertEqual(self.run_git("rev-parse", branch), before)

    def test_dirty_and_untracked_input_is_preserved(self):
        p = self.repo / "data/cities/personal.txt"
        p.write_text("must not be staged")
        result = self.patrol()
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(p.read_text(), "must not be staged")
        self.assertFalse(self.gh_log.exists())
        self.assertEqual(self.run_git("diff", "--cached", "--name-only"), "")

    def test_scope_and_unrelated_changes_stop_before_publication(self):
        for action in ["outscope", "maintainers", "last_patrol", "unrelated", "othercity", "untracked", "script", "readme", "json"]:
            with self.subTest(action=action):
                result = self.patrol(action, NO_PR="1")
                self.assertNotEqual(result.returncode, 0, result.stdout)
                self.assertFalse(self.gh_log.exists())
                self.assertFalse((self.repo / "executed.txt").exists())
                self.assertEqual(self.run_git("diff", "--cached", "--name-only"), "")
                self.run_git("restore", ".")
                extra = self.repo / "data/cities/new.txt"
                if extra.exists(): extra.unlink()

    def test_full_patrol_can_add_missing_documented_domain(self):
        result = self.patrol("missing_scan", SCOPE="all", NO_PR="1")
        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)

    def test_subsidies_scope_includes_scan(self):
        result = self.patrol("missing_scan", SCOPE="subsidies", NO_PR="1")
        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)

    def test_agent_commit_stops_publication(self):
        result = self.patrol("commit", NO_PR="1")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("HEAD", result.stderr)
        self.assertFalse(self.gh_log.exists())

    def test_agent_staging_stops_publication(self):
        # Stage a tracked unrelated change, then restore the worktree version.
        agent = self.bin / "claude"
        agent.write_text(agent.read_text().replace(
            'if action == "staged": subprocess.run(["git", "add", "other.txt"], check=True)',
            'if action == "staged":\n    pathlib.Path("other.txt").write_text("staged only")\n    subprocess.run(["git", "add", "other.txt"], check=True)\n    pathlib.Path("other.txt").write_text("unchanged\\n")'))
        result = self.patrol("staged", NO_PR="1")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("暂存区", result.stderr)
        self.assertFalse(self.gh_log.exists())

    def test_local_only_keeps_changes_without_github(self):
        result = self.patrol(NO_PR="1")
        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
        self.assertFalse(self.gh_log.exists())
        self.assertEqual(self.run_git("branch", "--show-current"), "main")
        self.assertIn("data/cities/testcity.yaml", self.run_git("diff", "--name-only"))

    def test_lock_blocks_same_checkout(self):
        lock = self.repo / ".git/rizi-patrol.lock"
        lock.mkdir()
        result = self.patrol()
        self.assertNotEqual(result.returncode, 0)
        self.assertTrue(lock.is_dir(), "Must not remove another run's lock")
        self.assertFalse(self.gh_log.exists())

    def test_agent_failure_releases_lock(self):
        result = self.patrol("fail", NO_PR="1")
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse((self.repo / ".git/rizi-patrol.lock").exists())
        self.assertFalse(self.gh_log.exists())

    def test_invalid_scope_and_city_are_rejected(self):
        for city, scope in [("../testcity", "all"), ("_template", "all"), ("testcity", "other")]:
            with self.subTest(city=city, scope=scope):
                self.assertNotEqual(self.patrol(city=city, SCOPE=scope).returncode, 0)
                self.assertFalse(self.gh_log.exists())

    def test_no_change_does_not_create_pr(self):
        result = self.patrol("nochange")
        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
        self.assertFalse(self.gh_log.exists())


if __name__ == "__main__":
    unittest.main()
