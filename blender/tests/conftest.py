import json
import os
import shutil
import subprocess
import sys

import pytest

TESTS_DIR = os.path.dirname(os.path.abspath(__file__))
BLENDER_DIR = os.path.dirname(TESTS_DIR)
SCRIPT = os.path.join(BLENDER_DIR, "render_venue.py")
for p in (BLENDER_DIR, TESTS_DIR):
    if p not in sys.path:
        sys.path.insert(0, p)


def _make(out, kind):
    subprocess.run([sys.executable, os.path.join(TESTS_DIR, "make_fixture.py"), "--out", str(out), "--kind", kind],
                   check=True, stdout=subprocess.DEVNULL, timeout=120)
    return str(out)


@pytest.fixture(scope="session")
def full_job_src(tmp_path_factory):
    """Pristine full fixture (never rendered into); copy it before writing outputs."""
    return _make(tmp_path_factory.mktemp("full_src"), "full")


@pytest.fixture(scope="session")
def sky_job_src(tmp_path_factory):
    return _make(tmp_path_factory.mktemp("sky_src"), "sky")


@pytest.fixture
def full_job(full_job_src, tmp_path):
    dst = tmp_path / "job"
    shutil.copytree(full_job_src, dst)
    return str(dst)


def load_json(path):
    with open(path) as fh:
        return json.load(fh)


def run_script(args, timeout=180):
    """Run render_venue.py with the current interpreter (pip bpy) -> (code, events, stdout, seconds)."""
    import time
    t = time.time()
    proc = subprocess.run([sys.executable, SCRIPT] + list(args), stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                          timeout=timeout)
    dt = time.time() - t
    out = proc.stdout.decode("utf-8", "replace")
    events = []
    for line in out.splitlines():
        i = line.find("@@WP ")
        if i >= 0:
            events.append(json.loads(line[i + 5:]))
    return proc.returncode, events, out, dt
