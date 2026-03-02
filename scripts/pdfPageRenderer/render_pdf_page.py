#!/usr/bin/env python3
"""Render a PDF page to PNG using PyMuPDF.

Example:
  python render_pdf_page.py --pdf input.pdf --page 2 --scale 2 --out page3.png
"""

import argparse
import os
import sys

try:
    import fitz
except Exception as error:  # pragma: no cover
    print(f"IMPORT_ERROR:{error}", file=sys.stderr)
    raise


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pdf", required=True)
    parser.add_argument("--page", type=int, default=-1)
    parser.add_argument("--scale", type=float, default=2.0)
    parser.add_argument("--out", default="")
    parser.add_argument("--all-pages-dir", default="")
    parser.add_argument("--page-count", action="store_true")
    args = parser.parse_args()

    doc = fitz.open(args.pdf)
    try:
        if args.page_count:
            print(len(doc))
            return

        if args.all_pages_dir:
            os.makedirs(args.all_pages_dir, exist_ok=True)
            total = len(doc)
            for idx in range(total):
                page = doc[idx]
                matrix = fitz.Matrix(args.scale, args.scale)
                get_pixmap = getattr(page, "get_pixmap", None)
                if not callable(get_pixmap):
                    raise RuntimeError("page object does not support get_pixmap")
                pix = get_pixmap(matrix=matrix, alpha=False)
                save_pix = getattr(pix, "save", None)
                if not callable(save_pix):
                    raise RuntimeError("pixmap object does not support save")
                out_path = os.path.join(args.all_pages_dir, f"page-{idx + 1:04d}.png")
                save_pix(out_path)
            print(total)
            return

        if args.page < 0 or args.page >= len(doc):
            raise RuntimeError(f"page out of range: {args.page}")
        if not args.out:
            raise RuntimeError("missing --out for render mode")

        page = doc[args.page]
        matrix = fitz.Matrix(args.scale, args.scale)
        get_pixmap = getattr(page, "get_pixmap", None)
        if not callable(get_pixmap):
            raise RuntimeError("page object does not support get_pixmap")
        pix = get_pixmap(matrix=matrix, alpha=False)
        save_pix = getattr(pix, "save", None)
        if not callable(save_pix):
            raise RuntimeError("pixmap object does not support save")
        save_pix(args.out)
    finally:
        doc.close()


if __name__ == "__main__":
    try:
        main()
    except Exception as error:  # pragma: no cover
        print(str(error), file=sys.stderr)
        sys.exit(1)
