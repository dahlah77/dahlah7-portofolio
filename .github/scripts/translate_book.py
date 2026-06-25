#!/usr/bin/env python3
"""Create a complete Indonesian translation of an OpenStax PDF."""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path
from typing import Iterable

import fitz
import requests
from docx import Document
from docx.enum.section import WD_SECTION
from docx.enum.style import WD_STYLE_TYPE
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches, Pt, RGBColor

TRANSLATE_URL = "https://translate.googleapis.com/translate_a/single"
MAX_CHARS = 3600
REQUEST_PAUSE_SECONDS = 0.28
SESSION = requests.Session()
SESSION.headers.update({"User-Agent": "Mozilla/5.0 (compatible; document-translation-workflow/1.0)"})


def compact_text(text: str) -> str:
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = text.replace("\u00ad", "")
    # Remove whitespace-only lines while retaining paragraph and list structure.
    text = re.sub(r"[ \t]+\n", "\n", text)
    text = re.sub(r"\n{4,}", "\n\n\n", text)
    return text.strip()


def chunks(text: str, limit: int = MAX_CHARS) -> Iterable[str]:
    """Split text near paragraph/sentence boundaries without losing characters."""
    if len(text) <= limit:
        yield text
        return
    start = 0
    n = len(text)
    while start < n:
        end = min(start + limit, n)
        if end < n:
            window = text[start:end]
            candidates = [window.rfind("\n\n"), window.rfind("\n"), window.rfind(". "), window.rfind("? "), window.rfind("! "), window.rfind("; "), window.rfind(", ")]
            cut = max(candidates)
            if cut > max(250, int(limit * 0.45)):
                if window[cut:cut+2] == "\n\n":
                    end = start + cut + 2
                elif window[cut] == "\n":
                    end = start + cut + 1
                else:
                    end = start + cut + 1
        yield text[start:end]
        start = end


def protect_urls(text: str) -> tuple[str, dict[str, str]]:
    saved: dict[str, str] = {}
    def repl(match: re.Match[str]) -> str:
        token = f"ZXQURLTOKEN{len(saved)}ZXQ"
        saved[token] = match.group(0)
        return token
    return re.sub(r"https?://[^\s)>,]+", repl, text), saved


def restore_urls(text: str, saved: dict[str, str]) -> str:
    for token, value in saved.items():
        text = text.replace(token, value)
        text = text.replace(token.lower(), value)
    return text


def needs_translation(text: str) -> bool:
    letters = re.findall(r"[A-Za-z]", text)
    return len(letters) >= 3


def translate_once(text: str) -> str:
    params = {
        "client": "gtx",
        "sl": "en",
        "tl": "id",
        "dt": "t",
        "q": text,
    }
    response = SESSION.get(TRANSLATE_URL, params=params, timeout=60)
    response.raise_for_status()
    payload = response.json()
    pieces = payload[0] if payload and payload[0] else []
    translated = "".join((piece[0] or "") for piece in pieces if piece)
    if not translated.strip() and text.strip():
        raise RuntimeError("Translation service returned an empty result")
    return translated


def translate_text(text: str, page_no: int) -> str:
    if not text or not needs_translation(text):
        return text
    protected, saved = protect_urls(text)
    out: list[str] = []
    for number, part in enumerate(chunks(protected), 1):
        if not needs_translation(part):
            out.append(part)
            continue
        last_error: Exception | None = None
        for attempt in range(1, 9):
            try:
                result = translate_once(part)
                out.append(result)
                last_error = None
                break
            except Exception as exc:  # retry rate limits and transient failures
                last_error = exc
                delay = min(30, 1.5 * attempt * attempt)
                print(f"Page {page_no}, block {number}: retry {attempt}/8 after {delay:.1f}s: {exc}", flush=True)
                time.sleep(delay)
        if last_error is not None:
            raise RuntimeError(f"Unable to translate source page {page_no}, block {number}") from last_error
        time.sleep(REQUEST_PAUSE_SECONDS)
    return restore_urls("".join(out), saved)


def set_cell_shading(cell, fill: str) -> None:
    tc_pr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:fill"), fill)
    tc_pr.append(shd)


def set_page_number(paragraph) -> None:
    paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = paragraph.add_run()
    fld_char1 = OxmlElement("w:fldChar")
    fld_char1.set(qn("w:fldCharType"), "begin")
    instr_text = OxmlElement("w:instrText")
    instr_text.set(qn("xml:space"), "preserve")
    instr_text.text = "PAGE"
    fld_char2 = OxmlElement("w:fldChar")
    fld_char2.set(qn("w:fldCharType"), "end")
    run._r.append(fld_char1)
    run._r.append(instr_text)
    run._r.append(fld_char2)


def add_run_text(paragraph, text: str, bold: bool = False, italic: bool = False) -> None:
    run = paragraph.add_run(text)
    run.bold = bold
    run.italic = italic


def classify_line(line: str) -> str:
    stripped = line.strip()
    if not stripped:
        return "blank"
    if re.match(r"^(BAB|PRAKATA|DAFTAR ISI|INDEKS)\b", stripped, flags=re.I):
        return "heading1"
    if re.match(r"^\d+\s+[A-Z].{0,100}$", stripped) and len(stripped) <= 115:
        return "heading1"
    if re.match(r"^\d+\.\d+(?:\.\d+)?\s+.{1,120}$", stripped) and len(stripped) <= 140:
        return "heading2"
    special = {
        "Mengapa Hal Ini Penting", "Hasil Pembelajaran", "Konsep dalam Praktik", "Tautan untuk Pembelajaran",
        "Ringkasan", "Istilah Kunci", "Pilihan Ganda", "Pertanyaan Tinjauan", "Masalah", "Aktivitas Video",
        "Garis Besar Bab", "Definisi Keuangan", "Bidang Dasar Keuangan", "Catatan", "Sumber"
    }
    if stripped in special:
        return "heading2"
    if re.match(r"^(Gambar|Tabel)\s+\d+\.\d+", stripped, flags=re.I):
        return "caption"
    if re.match(r"^[•\-–◦]\s+", stripped):
        return "bullet"
    if re.match(r"^(https?://|Sumber:|Catatan:)", stripped, flags=re.I):
        return "note"
    if stripped.isupper() and 3 <= len(stripped) <= 110:
        return "heading1"
    return "normal"


def create_document(translated_pages: list[str], out_dir: Path) -> tuple[Path, Path | None]:
    doc = Document()
    section = doc.sections[0]
    section.top_margin = Inches(0.72)
    section.bottom_margin = Inches(0.72)
    section.left_margin = Inches(0.78)
    section.right_margin = Inches(0.78)

    styles = doc.styles
    styles["Normal"].font.name = "DejaVu Serif"
    styles["Normal"]._element.rPr.rFonts.set(qn("w:eastAsia"), "DejaVu Serif")
    styles["Normal"].font.size = Pt(10.5)
    styles["Normal"].paragraph_format.space_after = Pt(4)
    styles["Normal"].paragraph_format.line_spacing = 1.08
    for name, size, color in [("Heading 1", 16, "183B6B"), ("Heading 2", 12, "1F5A88"), ("Title", 24, "183B6B")]:
        styles[name].font.name = "DejaVu Sans"
        styles[name]._element.rPr.rFonts.set(qn("w:eastAsia"), "DejaVu Sans")
        styles[name].font.size = Pt(size)
        styles[name].font.color.rgb = RGBColor.from_string(color)
    styles["Heading 1"].font.bold = True
    styles["Heading 2"].font.bold = True

    header = section.header.paragraphs[0]
    header.alignment = WD_ALIGN_PARAGRAPH.CENTER
    hrun = header.add_run("Prinsip-Prinsip Keuangan - Terjemahan Bahasa Indonesia")
    hrun.font.name = "DejaVu Sans"
    hrun.font.size = Pt(8)
    hrun.font.color.rgb = RGBColor(100, 100, 100)
    footer = section.footer.paragraphs[0]
    set_page_number(footer)

    # Cover
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_before = Pt(150)
    r = p.add_run("Prinsip-Prinsip\nKeuangan")
    r.bold = True
    r.font.name = "DejaVu Sans"
    r.font.size = Pt(30)
    r.font.color.rgb = RGBColor(24, 59, 107)
    p2 = doc.add_paragraph()
    p2.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r2 = p2.add_run("Terjemahan Bahasa Indonesia")
    r2.italic = True
    r2.font.size = Pt(14)
    doc.add_paragraph("")
    p3 = doc.add_paragraph()
    p3.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p3.add_run("Berdasarkan Principles of Finance - OpenStax\nJulie Dahlquist dan Rainford Knight").font.size = Pt(10)
    doc.add_page_break()

    for page_no, page_text in enumerate(translated_pages, 1):
        # Label facilitates cross-checking against the original PDF; body remains fully Indonesian.
        marker = doc.add_paragraph()
        marker.paragraph_format.space_after = Pt(6)
        marker_run = marker.add_run(f"Halaman sumber {page_no}")
        marker_run.font.name = "DejaVu Sans"
        marker_run.font.size = Pt(7.5)
        marker_run.font.color.rgb = RGBColor(120, 120, 120)
        marker_run.italic = True

        lines = page_text.split("\n")
        pending_blank = False
        for raw_line in lines:
            line = raw_line.strip()
            kind = classify_line(line)
            if kind == "blank":
                pending_blank = True
                continue
            if kind == "heading1":
                p = doc.add_paragraph(style="Heading 1")
                if pending_blank:
                    p.paragraph_format.space_before = Pt(8)
                p.add_run(line)
            elif kind == "heading2":
                p = doc.add_paragraph(style="Heading 2")
                if pending_blank:
                    p.paragraph_format.space_before = Pt(6)
                p.add_run(line)
            elif kind == "caption":
                p = doc.add_paragraph()
                p.paragraph_format.space_before = Pt(3)
                p.paragraph_format.space_after = Pt(3)
                add_run_text(p, line, italic=True)
            elif kind == "bullet":
                p = doc.add_paragraph(style="List Bullet")
                p.paragraph_format.space_after = Pt(2)
                p.add_run(re.sub(r"^[•\-–◦]\s+", "", line))
            elif kind == "note":
                p = doc.add_paragraph()
                p.paragraph_format.left_indent = Inches(0.2)
                p.paragraph_format.space_after = Pt(3)
                add_run_text(p, line, italic=True)
            else:
                p = doc.add_paragraph(style="Normal")
                if pending_blank:
                    p.paragraph_format.space_before = Pt(3)
                p.add_run(line)
            pending_blank = False
        if page_no < len(translated_pages):
            doc.add_page_break()

    doc.core_properties.title = "Prinsip-Prinsip Keuangan - Terjemahan Bahasa Indonesia"
    doc.core_properties.subject = "Terjemahan Bahasa Indonesia dari Principles of Finance, OpenStax"
    doc.core_properties.author = "OpenStax; terjemahan otomatis Bahasa Indonesia"
    out_dir.mkdir(parents=True, exist_ok=True)
    docx_path = out_dir / "Principles_of_Finance_Terjemahan_Bahasa_Indonesia.docx"
    doc.save(docx_path)

    pdf_path = out_dir / "Principles_of_Finance_Terjemahan_Bahasa_Indonesia.pdf"
    try:
        subprocess.run([
            "libreoffice", "--headless", "--convert-to", "pdf", "--outdir", str(out_dir), str(docx_path)
        ], check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=600)
    except Exception as exc:
        print(f"PDF conversion warning: {exc}", flush=True)
        pdf_path = None
    return docx_path, pdf_path if pdf_path and pdf_path.exists() else None


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("Usage: translate_book.py INPUT.pdf OUTPUT_DIR")
    source_pdf = Path(sys.argv[1])
    out_dir = Path(sys.argv[2])
    pdf = fitz.open(source_pdf)
    print(f"Source PDF opened: {len(pdf)} pages", flush=True)
    translated_pages: list[str] = []
    for page_index, page in enumerate(pdf, 1):
        source = compact_text(page.get_text("text"))
        if not source:
            translated_pages.append("")
            print(f"Page {page_index}/{len(pdf)}: no extractable text", flush=True)
            continue
        translated = translate_text(source, page_index)
        translated_pages.append(translated)
        print(f"Page {page_index}/{len(pdf)} translated ({len(source)} -> {len(translated)} chars)", flush=True)

    translated_txt = out_dir / "Principles_of_Finance_Terjemahan_Bahasa_Indonesia.txt"
    out_dir.mkdir(parents=True, exist_ok=True)
    translated_txt.write_text("\n\n".join(f"=== HALAMAN SUMBER {i} ===\n{text}" for i, text in enumerate(translated_pages, 1)), encoding="utf-8")
    docx_path, pdf_path = create_document(translated_pages, out_dir)
    print(f"Created: {translated_txt} ({translated_txt.stat().st_size} bytes)", flush=True)
    print(f"Created: {docx_path} ({docx_path.stat().st_size} bytes)", flush=True)
    if pdf_path:
        print(f"Created: {pdf_path} ({pdf_path.stat().st_size} bytes)", flush=True)

if __name__ == "__main__":
    main()
