"""A PDF builder for Sphinx, laid out as MyST Editor lays out PDFs. No LaTeX.

The project becomes one PDF: a cover, one table of contents with page numbers, each
chapter (each page in the root page's table of contents) from a new page, with
headers and footers and the fonts chosen. The settings are [pdf] in the project's
.mysteditor.toml (see MyST Editor's README); MyST Editor's File → Export PDF uses
this builder too. Rendered with WeasyPrint.

    pip install weasyprint beautifulsoup4    # and tomli, on Python older than 3.11

In conf.py, with this file in _ext/ next to it:

    import os, sys
    sys.path.insert(0, os.path.abspath("_ext"))
    extensions += ["mysteditor_pdf"]

Then:

    sphinx-build -b mysteditor-pdf docs _build/pdf

Config values (in conf.py, or -D name=value):

    mysteditor_pdf_file   where the PDF goes (default: <outdir>/<project>.pdf)
    mysteditor_pdf_date   what {date} says (default: today)
"""

import base64
import datetime
import os
import re
from pathlib import Path
from urllib.parse import unquote

from sphinx.builders.singlehtml import SingleFileHTMLBuilder
from sphinx.util import logging

__version__ = "1"

logger = logging.getLogger(__name__)

SETTINGS_FILE = ".mysteditor.toml"

# What [pdf] can say, and what it is when it doesn't.
DEFAULTS = {
    "paper": "A4",
    "logo": None,
    "title": None,
    "subtitle": "{date}",
    "note": "",
    "cover_background": None,
    "cover_color": None,
    "cover_images": [],
    "font": None,
    "heading_font": None,
    "code_font": None,
    "fonts": [],
    "header": ["", "", "{chapter}"],
    "footer": ["", "{page}", ""],
    "headers_on": "numbered",
    "numbering": "content",
    "toc_depth": 2,
}
# Settings that name files, relative to the settings file they're in.
FILE_SETTINGS = ("logo", "cover_background")

PAPER = {"A4": (210, 297), "Letter": (215.9, 279.4)}  # mm
MARGIN = {"top": 22, "side": 20, "bottom": 20}  # mm; the cover has none
TEXT_FONTS = '"Noto Sans", "Segoe UI", "DejaVu Sans", "Liberation Sans", Arial, sans-serif'
CODE_FONTS = '"DejaVu Sans Mono", "Liberation Mono", Consolas, monospace'
SLOTS = ["top-left", "top-center", "top-right", "bottom-left", "bottom-center", "bottom-right"]
IMAGE_TYPES = {".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp"}


# ---- settings ---------------------------------------------------------------------


def read_toml(path):
    try:
        import tomllib
    except ImportError:  # Python < 3.11
        try:
            import tomli as tomllib
        except ImportError:
            raise RuntimeError("Reading .mysteditor.toml on Python older than 3.11 needs tomli: pip install tomli")
    with open(path, "rb") as f:
        return tomllib.load(f)


def settings_files(confdir):
    """The .mysteditor.toml files that apply, outermost first: from the repository's
    top (or the filesystem's) down to conf.py's folder."""
    found = []
    d = Path(confdir).resolve()
    while True:
        if (d / SETTINGS_FILE).is_file():
            found.append(d / SETTINGS_FILE)
        if (d / ".git").exists() or d.parent == d:
            break
        d = d.parent
    return list(reversed(found))


def load_settings(confdir):
    """[pdf] from each settings file, later (inner) ones overriding; files named in
    them as absolute paths."""
    s = dict(DEFAULTS)
    for path in settings_files(confdir):
        try:
            pdf = read_toml(path).get("pdf", {})
        except Exception as e:
            logger.warning("%s: couldn't read it: %s", path, e)
            continue
        here = path.parent
        for key, value in pdf.items():
            if key not in DEFAULTS:
                logger.warning('%s: [pdf] unknown setting "%s"', path, key)
            elif key in FILE_SETTINGS:
                s[key] = str(here / value) if value else None
            elif key == "fonts":
                s[key] = [str(here / f) for f in value]
            elif key == "cover_images":
                s[key] = [dict(img, file=str(here / img["file"])) for img in value if isinstance(img, dict) and img.get("file")]
            else:
                s[key] = value
    if s["paper"] not in PAPER:
        logger.warning("[pdf] paper must be A4 or Letter, not %r", s["paper"])
        s["paper"] = "A4"
    return s


# ---- files as URLs ----------------------------------------------------------------


def data_url(path):
    data = Path(path).read_bytes()
    kind = IMAGE_TYPES.get(Path(path).suffix.lower(), "application/octet-stream")
    return "data:%s;base64,%s" % (kind, base64.b64encode(data).decode("ascii"))


def image_ratio(path):
    """Width over height."""
    try:
        if path.lower().endswith(".svg"):
            svg = Path(path).read_text("utf-8", "replace")
            box = re.search(r'viewBox\s*=\s*["\']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)', svg)
            if box and float(box.group(2)):
                return float(box.group(1)) / float(box.group(2))
            w = re.search(r'<svg[^>]*\swidth\s*=\s*["\']([\d.]+)', svg)
            h = re.search(r'<svg[^>]*\sheight\s*=\s*["\']([\d.]+)', svg)
            if w and h and float(h.group(1)):
                return float(w.group(1)) / float(h.group(1))
        else:
            from PIL import Image  # WeasyPrint's own dependency

            with Image.open(path) as im:
                return im.width / im.height
    except Exception:
        pass
    return 3.0


def margin_logo(path):
    """The logo for the headers and footers: an SVG of their height (a margin box shows
    an image at its own size)."""
    height = 30  # px, about 8 mm
    width = round(height * image_ratio(path))
    svg = (
        '<svg xmlns="http://www.w3.org/2000/svg" width="%d" height="%d" viewBox="0 0 %d %d">'
        '<image href="%s" width="%d" height="%d" preserveAspectRatio="xMidYMid meet"/></svg>'
    ) % (width, height, width, height, data_url(path), width, height)
    return "data:image/svg+xml;base64," + base64.b64encode(svg.encode("utf-8")).decode("ascii")


WEIGHTS = [
    (r"thin|hairline", 100),
    (r"extra-?light|ultra-?light", 200),
    (r"light", 300),
    (r"medium", 500),
    (r"semi-?bold|demi-?bold", 600),
    (r"extra-?bold|ultra-?bold", 800),
    (r"black|heavy", 900),
    (r"bold", 700),
]


def font_face(path):
    """An @font-face rule for a font file: its family, weight and style from its own
    tables (fontTools, a WeasyPrint dependency), or from its name."""
    stem = Path(path).stem
    parts = re.split(r"[-_ ](?=[^-_ ]*$)", stem)
    styles = parts[1] if len(parts) > 1 else ""
    family = parts[0] if styles else stem
    weight = next((str(w) for pattern, w in WEIGHTS if re.search(pattern, styles, re.I)), "400")
    italic = bool(re.search(r"italic|oblique", styles, re.I))
    try:
        import logging as std_logging

        from fontTools.ttLib import TTFont

        std_logging.getLogger("fontTools").setLevel(std_logging.ERROR)  # odd timestamps and the like

        font = TTFont(path, lazy=True, fontNumber=0)
        names = font["name"]
        family = names.getDebugName(16) or names.getDebugName(1) or family
        if "OS/2" in font:
            weight = str(font["OS/2"].usWeightClass)
            italic = bool(font["OS/2"].fsSelection & 1)
        if "fvar" in font:
            for axis in font["fvar"].axes:
                if axis.axisTag == "wght":
                    weight = "%d %d" % (axis.minValue, axis.maxValue)
    except Exception:
        pass  # WOFF2 without brotli, or not a font fontTools reads: its name will do
    return '@font-face { font-family: %s; font-weight: %s; font-style: %s; src: url("%s"); }' % (
        css_string(family),
        weight,
        "italic" if italic else "normal",
        Path(path).resolve().as_uri(),
    )


def css_string(text):
    return '"%s"' % text.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\A ")


def families(name, fallback):
    return "%s, %s" % (css_string(name), fallback) if name else fallback


# ---- the layout -------------------------------------------------------------------


def text_of(el):
    return " ".join(el.get_text().split())


class Layout:
    """The one-page build made into a document for print: cover, contents, chapters,
    unique ids and working links. Then the CSS for it, and the HTML, once the number
    of pages is known (for {pages})."""

    def __init__(self, soup, s, root_doc, date, version, project):
        self.soup, self.s = soup, s
        self.date, self.version, self.project = date, version, project
        main = soup.select_one('[role="main"]') or soup.body
        self.main = main

        def is_marker(el):
            return el is not None and el.name == "span" and el.get("id", "").startswith("document-")

        def doc_of(el):
            sections = ([el] if el.name == "section" else []) + el.find_parents("section")
            for sec in sections:
                prev = sec.find_previous_sibling()
                if is_marker(prev):
                    return prev["id"][len("document-") :]
            return root_doc

        def depth(el):
            return (1 if el.name == "section" else 0) + len(el.find_parents("section"))

        def heading_of(sec):
            return sec.find(re.compile(r"^h[1-6]$"), recursive=False)

        for a in main.select("a.headerlink"):
            a.decompose()

        # Ids are unique within a page, not across pages: later ones get a number.
        markers = {m["id"][len("document-") :]: m for m in main.find_all("span", id=re.compile(r"^document-"))}
        taken = {"document-" + name for name in markers}
        ids = {}
        for el in main.find_all(id=True):
            if is_marker(el):
                continue
            old = el["id"]
            new, n = old, 2
            while new in taken:
                new, n = "%s-%d" % (old, n), n + 1
            taken.add(new)
            ids[doc_of(el) + "#" + old] = new
            el["id"] = new
        # Links to other pages are written "#document-<page>#<id>" (or "#document-<page>").
        for a in main.find_all("a", href=re.compile(r"^#")):
            href = unquote(a["href"][1:])
            m = re.match(r"^document-([^#]+)(?:#(.+))?$", href)
            if m and m.group(2):
                target = ids.get(m.group(1) + "#" + m.group(2), m.group(2))
            elif m:
                marker = markers.get(m.group(1))
                start = marker.find_next_sibling() if marker else None
                target = start["id"] if start is not None and start.get("id") else "document-" + m.group(1)
            else:
                target = ids.get(doc_of(a) + "#" + href, href)
            a["href"] = "#" + target

        sections = main.find_all("section")
        root = next((sec for sec in sections if depth(sec) == 1), None)
        # Chapters: the pages in the root page's contents; each from a new page, its
        # title the {chapter} of the headers and footers.
        self.chapters = [sec for sec in sections if depth(sec) == 2 and is_marker(sec.find_previous_sibling()) and heading_of(sec)]
        for sec in self.chapters:
            sec["class"] = sec.get("class", []) + ["pdf-chapter"]
            h = heading_of(sec)
            h["class"] = h.get("class", []) + ["pdf-chapter-title"]
        self.numbering = s["numbering"] if self.chapters else "cover"

        h1 = heading_of(root) if root is not None else None
        self.title = s["title"] or (text_of(h1) if h1 is not None else project)
        self.title = self.fill(self.title)
        if h1 is not None:
            h1.decompose()

        # The contents: links to sections; their page numbers come from the PDF
        # (target-counter).
        toc = soup.new_tag("nav", attrs={"class": "pdf-toc pdf-front"})
        heading = soup.new_tag("div", attrs={"class": "pdf-toc-title"})
        heading.string = "Contents"
        toc.append(heading)
        for sec in sections:
            level = depth(sec) - 1
            h = heading_of(sec)
            if level < 1 or level > int(s["toc_depth"]) or h is None or not sec.get("id"):
                continue
            # To the heading, not its section: a section can start at the foot of a page
            # whose heading goes on the next (and the number is the heading's page).
            if not h.get("id"):
                h["id"] = "pdf-title-" + sec["id"]
            a = soup.new_tag("a", href="#" + h["id"], attrs={"class": "pdf-toc-entry pdf-toc-l%d" % level})
            a.string = text_of(h)
            toc.append(a)

        # The root page's own text, before the chapters, goes with the front pages.
        if root is not None:
            for el in list(root.find_all(recursive=False)):
                if any(el is c or c in el.descendants for c in self.chapters):
                    break
                el["class"] = el.get("class", []) + ["pdf-front"]
        # The markers between pages: links now go to the pages' sections.
        for m in markers.values():
            m["style"] = "display: none"

        self.cover = self.make_cover()
        main.insert(0, toc)
        main.insert(0, self.cover)

    def fill(self, text):
        values = {"title": getattr(self, "title", ""), "date": self.date, "version": self.version, "project": self.project}
        return re.sub(r"\{(\w+)\}", lambda m: values.get(m.group(1), m.group(0)), text)

    def make_cover(self):
        s, soup = self.s, self.soup
        w, h = PAPER[s["paper"]]
        style = "width: %smm; height: %smm;" % (w, h)
        if s["cover_background"]:
            style += ' background-image: url("%s");' % Path(s["cover_background"]).resolve().as_uri()
        if s["cover_color"]:
            style += " color: %s;" % s["cover_color"]
        cover = soup.new_tag("div", attrs={"class": "pdf-title" + (" pdf-title-colored" if s["cover_color"] else ""), "style": style})
        body = soup.new_tag("div", attrs={"class": "pdf-cover-body"})
        if s["logo"]:
            body.append(soup.new_tag("img", src=Path(s["logo"]).resolve().as_uri(), attrs={"class": "pdf-cover-logo"}))
        for cls, text in (("pdf-title-text", self.title), ("pdf-subtitle", self.fill(s["subtitle"])), ("pdf-note", self.fill(s["note"]))):
            if text:
                div = soup.new_tag("div", attrs={"class": cls})
                div.string = text
                body.append(div)
        cover.append(body)
        for g in s["cover_images"]:
            height = "%smm" % g["height"] if g.get("height") is not None else "auto"
            cover.append(
                soup.new_tag(
                    "img",
                    src=Path(g["file"]).resolve().as_uri(),
                    attrs={"class": "pdf-cover-image", "style": "left: %smm; top: %smm; width: %smm; height: %s" % (g.get("x", 0), g.get("y", 0), g.get("width", 40), height)},
                )
            )
        # Its headers and footers, drawn on it: its page has no margins.
        self.cover_slots = []
        if s["headers_on"] == "all":
            for row in ("top", "bottom"):
                div = soup.new_tag("div", attrs={"class": "pdf-cover-margin pdf-cover-" + row})
                for _ in range(3):
                    span = soup.new_tag("span")
                    div.append(span)
                    self.cover_slots.append(span)
                cover.append(div)
        return cover

    def templates(self):
        return list(self.s["header"]) + list(self.s["footer"])

    @staticmethod
    def counts(template):
        return bool(re.search(r"\{pages?\}", template))

    def content(self, template, pages):
        """A margin box's CSS content: text, the page counters, the chapter, the logo."""
        parts = []
        for piece in re.split(r"(\{(?:page|pages|logo|chapter)\})", template):
            if piece == "{page}":
                parts.append("counter(page)")
            elif piece == "{pages}":
                parts.append("counter(pages)" if pages is None else css_string(str(pages)))
            elif piece == "{chapter}":
                parts.append("string(chapter)")
            elif piece == "{logo}":
                if self.s["logo"]:
                    parts.append('url("%s")' % margin_logo(self.s["logo"]))
            elif piece:
                parts.append(css_string(self.fill(piece)))
        return " ".join(parts) or "none"

    def css(self, pages=None):
        s = self.s
        box = "font-family: var(--pdf-font); font-size: 8.5pt; color: #57606a;"

        def boxes(unnumbered):
            return " ".join(
                "@%s { content: %s; %s }" % (slot, "none" if unnumbered and self.counts(t) else self.content(t, pages), box) for slot, t in zip(SLOTS, self.templates())
            )

        blank = " ".join("@%s { content: none; }" % slot for slot in SLOTS)
        # Numbered from the first chapter: the pages before it aren't counted.
        skip = "counter-increment: page 0;" if self.numbering == "content" else ""
        if self.numbering == "content":
            front = blank if s["headers_on"] == "numbered" else boxes(True)
        else:
            front = boxes(False)
        rules = [
            "@page { size: %s; margin: %smm %smm %smm; %s }" % (s["paper"], MARGIN["top"], MARGIN["side"], MARGIN["bottom"], boxes(False)),
            "@page pdf-cover { margin: 0; %s %s }" % (skip, blank),
            "@page pdf-front { %s %s }" % (skip, front),
            ":root { --pdf-font: %s; --pdf-heading-font: %s; --pdf-code-font: %s; }"
            % (families(s["font"], TEXT_FONTS), families(s["heading_font"] or s["font"], TEXT_FONTS), families(s["code_font"], CODE_FONTS)),
        ]
        rules += [font_face(f) for f in s["fonts"] if Path(f).is_file()]
        missing = [f for f in s["fonts"] if not Path(f).is_file()]
        for f in missing:
            logger.warning("[pdf] there's no font file at %s", f)
        return PRINT_CSS + "\n" + "\n".join(rules)

    def html(self, pages=None):
        """The document, with the cover's headers and footers for the number of pages."""
        for span, template in zip(self.cover_slots, self.templates()):
            span.clear()
            if self.numbering == "content" and self.counts(template):
                continue
            for piece in re.split(r"(\{(?:page|pages|logo|chapter)\})", template):
                if piece == "{logo}":
                    if self.s["logo"]:
                        span.append(self.soup.new_tag("img", src=Path(self.s["logo"]).resolve().as_uri()))
                elif piece == "{page}":
                    span.append("1")
                elif piece == "{pages}":
                    span.append("" if pages is None else str(pages))
                elif piece and piece != "{chapter}":
                    span.append(self.fill(piece))
        return str(self.soup)


# ---- the builder ------------------------------------------------------------------


class PdfBuilder(SingleFileHTMLBuilder):
    """The project as one page (singlehtml) with the plain theme, then as a PDF."""

    name = "mysteditor-pdf"
    epilog = "The PDF is %(outdir)s"

    def get_theme_config(self):
        # The HTML theme's screen layout doesn't print well.
        return "basic", {}

    def add_sidebars(self, pagename, ctx):
        ctx["sidebars"] = []

    def finish(self):
        super().finish()
        try:
            from bs4 import BeautifulSoup
            from weasyprint import CSS, HTML
            from weasyprint.text.fonts import FontConfiguration
        except ImportError as e:
            raise RuntimeError("The PDF needs WeasyPrint and Beautiful Soup: pip install weasyprint beautifulsoup4 (%s)" % e)
        config = self.config
        html_file = Path(self.outdir) / (config.root_doc + self.out_suffix)
        settings = load_settings(self.confdir)
        date = config.mysteditor_pdf_date or "{d:%B} {d.day}, {d.year}".format(d=datetime.date.today())
        with open(html_file, encoding="utf-8") as f:
            soup = BeautifulSoup(f, "html.parser")
        layout = Layout(soup, settings, config.root_doc, date, config.release or config.version or "", config.project or "")
        target = Path(config.mysteditor_pdf_file or Path(self.outdir) / ("%s.pdf" % (re.sub(r'[\\/:*?"<>|]+', " ", config.project or "").strip() or "manual")))

        def render(pages=None):
            # @font-face rules need the same font configuration for the CSS and the render.
            fonts = FontConfiguration()
            css = CSS(string=layout.css(pages), font_config=fonts)
            return HTML(string=layout.html(pages), base_url=str(html_file)).render(stylesheets=[css], font_config=fonts)

        logger.info("laying out the PDF...")
        document = render()
        # Numbered from the first chapter: {pages} counts from it too.
        if layout.numbering == "content" and any(layout.counts(t) for t in layout.templates()) and layout.chapters:
            first = layout.chapters[0].get("id")
            front = next((i for i, page in enumerate(document.pages) if first in page.anchors), 0)
            logger.info("numbering the PDF's pages...")
            document = render(len(document.pages) - front)
        target.parent.mkdir(parents=True, exist_ok=True)
        document.write_pdf(target)
        self.pdf_result = {"file": str(target), "pages": len(document.pages)}
        logger.info("the PDF is %s (%d pages)", target, len(document.pages))


def setup(app):
    app.add_builder(PdfBuilder)
    app.add_config_value("mysteditor_pdf_file", "", "env")
    app.add_config_value("mysteditor_pdf_date", "", "env")
    return {"version": __version__, "parallel_read_safe": True, "parallel_write_safe": True}


PRINT_CSS = """
:root { --pdf-font: %(text)s; --pdf-heading-font: var(--pdf-font); --pdf-code-font: %(code)s; }
html { font-size: 10.5pt; }
body { margin: 0; font-family: var(--pdf-font); color: #1f2328; background: #fff; line-height: 1.5; }
div.related, div.sphinxsidebar, div.footer, div.clearer, a.headerlink, #searchbox, nav.contents, div.contents.local { display: none !important; }
div.document, div.documentwrapper, div.bodywrapper, div.body {
  margin: 0 !important; padding: 0 !important; float: none !important; width: auto !important; max-width: none !important; min-width: 0 !important;
}
h1, h2, h3, h4, h5, h6, .pdf-title-text, .pdf-toc-title { font-family: var(--pdf-heading-font); }
h1, h2, h3, h4, h5, h6 { font-weight: 700; line-height: 1.25; margin: 1.4em 0 0.5em; break-after: avoid; }
h1, h2 { font-size: 1.9em; }
h3 { font-size: 1.4em; }
h4 { font-size: 1.15em; }
h5, h6 { font-size: 1em; }
section.pdf-chapter { break-before: page; }
.pdf-chapter-title { string-set: chapter content(); margin-top: 0; }
.pdf-front { page: pdf-front; }
p, li, dd { orphans: 3; widows: 3; }
div.body p, div.body dd, div.body li, div.body blockquote { hyphens: manual; }
a { color: #0b57d0; text-decoration: none; }
code, pre, kbd, samp { font-family: var(--pdf-code-font); font-size: 0.88em; }
code.literal { background: #f2f3f5; border-radius: 3px; padding: 0.05em 0.3em; }
div.highlight { background: #f6f8fa !important; border: 1px solid #e3e6ea; border-radius: 6px; margin: 0.8em 0; }
pre { margin: 0; padding: 0.7em 0.9em; white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.4; background: transparent !important; border: 0 !important; }
img { max-width: 100%%; height: auto; }
figure, div.figure { break-inside: avoid; margin: 1em 0; }
figcaption, .caption { color: #57606a; font-size: 0.92em; }
table.docutils { border-collapse: collapse; margin: 0.8em 0 !important; max-width: 100%%; }
table.docutils th, table.docutils td { border: 1px solid #d0d7de !important; padding: 0.35em 0.6em; vertical-align: top; text-align: left; }
table.docutils th { background: #f2f4f7; }
table.docutils td > p, table.docutils th > p { margin: 0; }
thead { display: table-header-group; }
tr { break-inside: avoid; }
div.admonition, aside.admonition { margin: 0.9em 0; padding: 0.6em 0.9em; border-left: 4px solid #8c959f; background: #f6f8fa; border-radius: 4px; break-inside: avoid; }
.admonition p.admonition-title { font-weight: 700; margin: 0 0 0.3em; }
.admonition > :last-child { margin-bottom: 0; }
.admonition.note, .admonition.seealso, .admonition.important { border-color: #0969da; background: #eef5ff; }
.admonition.tip, .admonition.hint { border-color: #1a7f37; background: #eefbf1; }
.admonition.warning, .admonition.caution, .admonition.attention { border-color: #bf8700; background: #fff8e5; }
.admonition.danger, .admonition.error { border-color: #cf222e; background: #fff0f0; }
dl dt { font-weight: 600; }

.pdf-title { page: pdf-cover; break-after: page; position: relative; overflow: hidden; background: center / cover no-repeat; }
.pdf-cover-body { position: absolute; left: %(side)smm; right: %(side)smm; top: %(top)smm; bottom: %(bottom)smm; }
.pdf-cover-logo { display: block; max-height: 28mm; max-width: 90mm; }
.pdf-title-text { position: absolute; left: 0; right: 0; top: 45%%; font-size: 30pt; font-weight: 700; line-height: 1.15; }
.pdf-subtitle { position: absolute; left: 0; right: 0; top: calc(45%% + 16mm); color: #57606a; font-size: 12pt; }
.pdf-note { position: absolute; left: 0; right: 0; bottom: 0; color: #57606a; font-size: 9pt; white-space: pre-line; }
.pdf-title-colored .pdf-subtitle, .pdf-title-colored .pdf-note, .pdf-title-colored .pdf-cover-margin { color: inherit; opacity: 0.85; }
.pdf-cover-image { position: absolute; }
.pdf-cover-margin { position: absolute; left: %(side)smm; right: %(side)smm; display: flex; align-items: center; font-family: var(--pdf-font); font-size: 8.5pt; color: #57606a; }
.pdf-cover-margin span { flex: 1; }
.pdf-cover-top { top: 0; height: %(top)smm; }
.pdf-cover-bottom { bottom: 0; height: %(bottom)smm; }
.pdf-cover-margin span:nth-child(2) { text-align: center; }
.pdf-cover-margin span:nth-child(3) { text-align: right; }
.pdf-cover-margin img { height: 8mm; vertical-align: middle; }

.pdf-toc { break-after: page; }
.pdf-toc-title { font-size: 1.9em; font-weight: 700; margin-bottom: 0.8em; }
.pdf-toc-entry { display: block; color: inherit; margin: 0.22em 0; break-inside: avoid; }
.pdf-toc-entry::after { content: leader(".") target-counter(attr(href), page); float: none; color: #57606a; }
.pdf-toc-l1 { font-weight: 600; margin-top: 0.7em; }
.pdf-toc-l2 { padding-left: 1.5em; }
.pdf-toc-l3 { padding-left: 3em; }
.pdf-toc-l4 { padding-left: 4.5em; }
""" % {"text": TEXT_FONTS, "code": CODE_FONTS, "top": MARGIN["top"], "side": MARGIN["side"], "bottom": MARGIN["bottom"]}
