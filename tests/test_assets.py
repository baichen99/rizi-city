"""Versioned browser assets still yield a self-contained offline file."""
import hashlib
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import build


class AssetBuildTests(unittest.TestCase):
    def test_content_versions_are_stable_and_change_with_asset(self):
        with tempfile.TemporaryDirectory() as directory:
            site = Path(directory)
            page = site / 'index.html'
            page.write_text('<link rel="stylesheet" href="style.css"><script src="app.js"></script>')
            (site / 'style.css').write_text('body {color: black}')
            (site / 'app.js').write_text('const version = 1;')
            with patch.object(build, 'SITE', site):
                build.update_asset_versions()
                first = page.read_text()
                build.update_asset_versions()
                self.assertEqual(first, page.read_text())
                (site / 'app.js').write_text('const version = 2;')
                build.update_asset_versions()
                digest = hashlib.sha256((site / 'app.js').read_bytes()).hexdigest()[:12]
                self.assertIn(f'app.js?v={digest}', page.read_text())
                self.assertNotEqual(first, page.read_text())

    def test_versioned_assets_are_inlined_offline(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            site = root / 'site'
            site.mkdir()
            (site / 'index.html').write_text('<link rel="stylesheet" href="style.css?v=abc"><script src="app.js?v=def"></script>')
            (site / 'style.css').write_text('body {color: black}')
            (site / 'app.js').write_text(r'const pattern = /\d+/;')
            offline = root / 'offline.html'
            with patch.object(build, 'SITE', site), patch.object(build, 'OFFLINE', offline), patch.object(build, 'ROOT', root):
                build.build_offline({'cities': []})
            html = offline.read_text()
            self.assertIn('window.RIZI_OFFLINE=true', html)
            self.assertIn(r'const pattern = /\d+/;', html)
            self.assertNotIn('src="app.js', html)
            self.assertNotIn('href="style.css', html)

    def test_missing_asset_reference_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            site = Path(directory)
            (site / 'index.html').write_text('<main>missing references</main>')
            (site / 'style.css').write_text('')
            with patch.object(build, 'SITE', site), self.assertRaises(ValueError):
                build.update_asset_versions()


if __name__ == '__main__':
    unittest.main()
