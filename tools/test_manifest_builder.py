from __future__ import annotations

import unittest
from pathlib import Path

import build_harureader_manifest as builder


class ManifestBuilderTests(unittest.TestCase):
    def setUp(self) -> None:
        self.original_src = builder.SRC
        builder.SRC = Path("/harureader/src")

    def tearDown(self) -> None:
        builder.SRC = self.original_src

    def test_content_folders_assign_expected_types(self) -> None:
        cases = {
            "skits/example.md": "skit",
            "stories/example.md": "short story",
            "short-stories/example.md": "short story",
            "books/example/chapter-01.md": "novel",
            "novels/example/chapter-01.md": "novel",
        }
        for relative_path, expected in cases.items():
            with self.subTest(relative_path=relative_path):
                path = builder.SRC / relative_path
                self.assertEqual(builder.kind_for(path, {}, []), expected)

    def test_book_folder_becomes_series_name(self) -> None:
        path = builder.SRC / "books" / "glass-city" / "chapter-01.md"
        self.assertEqual(builder.series_for(path, {}), "Glass City")

    def test_inline_tag_lists_are_clean(self) -> None:
        self.assertEqual(builder.parse_value("tags", "[mystery, Mina]"), ["mystery", "Mina"])

    def test_roadmap_is_never_a_library_entry(self) -> None:
        self.assertIn("roadmap.md", builder.EXCLUDED_SOURCE_FILES)

    def test_ambient_cues_do_not_appear_in_reader_metadata(self) -> None:
        source = "Before.\n<!-- ambient: storm -->\nAfter."
        self.assertEqual(builder.clean_markdown(source), "Before. After.")


if __name__ == "__main__":
    unittest.main()
