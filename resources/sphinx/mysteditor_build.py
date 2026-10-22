"""Build a Sphinx project for MyST Editor and report what the editor needs as JSON.

Run with the project's environment's Python:

    python mysteditor_build.py --srcdir DIR --outdir DIR --doctreedir DIR \
        --result FILE [--builder html] [--fresh]

The result file holds the toctree, page titles, every cross-reference target and
the warnings, each tagged with the build phase it came from:

- setup / finish: project-wide, re-reported by every build
- read: from parsing a document; only re-reported when it is re-read
- consistency: project-wide checks, re-run whenever anything was re-read
- write: from resolving references; only re-reported when it is re-written

Incremental builds only re-warn about what they touched, so the editor merges each
result into the warnings it already has.

Only public Sphinx APIs are used, so this works with Sphinx 5 and later.
"""

import argparse
import io
import json
import os
import re
import sys
import time
import traceback

# "path:line: WARNING: message [type.subtype]" (line and type are optional)
WARNING_RE = re.compile(
    r"^(?:(?P<path>.+?):(?:(?P<line>\d+):)?\s)?(?P<level>WARNING|ERROR|CRITICAL|SEVERE):\s(?P<message>.*?)(?:\s\[(?P<type>[\w.-]+)\])?$"
)


class WarningCollector(io.TextIOBase):
    """Warning stream that parses Sphinx's output and records the current phase."""

    def __init__(self):
        self.phase = "setup"
        self.items = []
        self.raw = []
        self._partial = ""

    def writable(self):
        return True

    def write(self, text):
        self.raw.append(text)
        self._partial += text
        *lines, self._partial = self._partial.split("\n")
        for line in lines:
            self._line(line)
        return len(text)

    def _line(self, line):
        line = re.sub(r"\x1b\[[0-9;]*m", "", line).rstrip()
        if not line:
            return
        m = WARNING_RE.match(line)
        if m:
            self.items.append(
                {
                    "path": m.group("path"),
                    "line": int(m.group("line")) if m.group("line") else None,
                    "level": m.group("level").lower(),
                    "message": m.group("message"),
                    "type": m.group("type"),
                    "phase": self.phase,
                }
            )
        elif self.items:
            # Continuation of a multi-line message.
            self.items[-1]["message"] += "\n" + line


def text_of(node):
    return node.astext() if node is not None else None


# Blocks the editor shows itself; previews are rendered for everything else (custom
# directives, tables, definition lists, ...).
NO_PREVIEW = {
    "paragraph", "bullet_list", "enumerated_list", "literal_block", "title", "target", "comment",
    "transition", "section", "substitution_definition", "index", "block_quote", "math_block",
    "system_message", "raw_text",
}
MAX_FRAGMENT = 300_000


def line_of(node):
    """The source line of a block, or of the first thing inside it that has one."""
    if getattr(node, "line", None):
        return node.line
    walk = getattr(node, "findall", None) or node.traverse
    for child in walk(include_self=False):
        if getattr(child, "line", None):
            return child.line
    return None


def export_fragments(app, doctree, docname, outdir):
    """HTML for each previewable top-level block of a page, keyed by source line,
    written to <outdir>/_mysteditor/fragments/<docname>.json for the editor's cards."""
    from docutils import nodes

    render = getattr(app.builder, "render_partial", None)
    if render is None:
        return  # not an HTML builder
    own_source = str(app.env.doc2path(docname))
    fragments = []

    def walk(parent):
        for node in parent.children:
            if isinstance(node, nodes.section):
                walk(node)
                continue
            if node.tagname in NO_PREVIEW or not isinstance(node, nodes.Element):
                continue
            source = getattr(node, "source", None)
            if source and os.path.abspath(source) != os.path.abspath(own_source):
                continue  # e.g. content pulled in by {include}
            line = line_of(node)
            if not line:
                continue
            try:
                html = render(node.deepcopy())["fragment"]
            except Exception:
                continue
            # Skip empty output and bare HTML comments (e.g. conditional-content markers).
            bare = html.strip()
            if bare and not re.fullmatch(r"(?:<!--.*?-->\s*)+", bare, re.S) and len(html) <= MAX_FRAGMENT:
                fragments.append({"line": line, "html": html})

    walk(doctree)
    try:
        uri = app.builder.get_target_uri(docname)
    except Exception:
        uri = None
    path = os.path.join(outdir, "_mysteditor", "fragments", docname + ".json")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump({"uri": uri, "fragments": fragments}, f)


def mark_lines(app, doctree, docname):
    """Tag each section and top-level block of a page with its source line, as a
    mysteditor-line-N class, so the preview can scroll along with the editor. The
    output is the editor's own build, not the project's."""
    from docutils import nodes

    own_source = os.path.abspath(str(app.env.doc2path(docname)))

    def walk(parent):
        for node in parent.children:
            if not isinstance(node, nodes.Element):
                continue
            source = getattr(node, "source", None)
            if source and os.path.abspath(source) != own_source:
                continue  # included from another file
            line = line_of(node)
            if line:
                node["classes"].append(f"mysteditor-line-{line}")
            if isinstance(node, nodes.section):
                walk(node)

    walk(doctree)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--srcdir", required=True)
    parser.add_argument("--outdir", required=True)
    parser.add_argument("--doctreedir", required=True)
    parser.add_argument("--result", required=True)
    parser.add_argument("--builder", default="html")
    parser.add_argument("--fresh", action="store_true")
    args = parser.parse_args()

    started = time.time()
    warnings = WarningCollector()
    result = {"ok": False}
    read_docs, written_docs = set(), set()
    try:
        from sphinx import __display_version__ as sphinx_version
        from sphinx.application import Sphinx

        result["sphinx_version"] = sphinx_version
        app = Sphinx(
            srcdir=args.srcdir,
            confdir=args.srcdir,
            outdir=args.outdir,
            doctreedir=args.doctreedir,
            buildername=args.builder,
            status=sys.stderr,
            warning=warnings,
            freshenv=args.fresh,
        )

        # Sphinx buffers warnings while reading and flushes them when reading ends,
        # so phases switch at the events that follow each flush.
        consistency = {"checked": False}

        def before_read(_app, _env, docnames):
            warnings.phase = "read"
            read_docs.update(docnames)

        def check_consistency(_app, _env):
            warnings.phase = "consistency"
            consistency["checked"] = True

        def write_started(_app, _builder):
            warnings.phase = "write"

        def doctree_resolved(_app, doctree, docname):
            warnings.phase = "write"  # for Sphinx < 7.3, which lacks write-started
            written_docs.add(docname)
            try:
                export_fragments(_app, doctree, docname, args.outdir)
                mark_lines(_app, doctree, docname)
            except Exception:
                traceback.print_exc()  # previews are optional; never fail the build

        app.connect("env-before-read-docs", before_read)
        app.connect("env-check-consistency", check_consistency)
        app.connect("doctree-resolved", doctree_resolved)
        try:
            app.connect("write-started", write_started)
        except Exception:
            pass
        app.build(force_all=args.fresh)
        warnings.phase = "finish"

        env = app.env
        srcdir = os.path.abspath(args.srcdir)

        def source_of(docname):
            return os.path.relpath(str(env.doc2path(docname)), srcdir).replace(os.sep, "/")

        docs = {}
        for docname in sorted(env.found_docs):
            try:
                uri = app.builder.get_target_uri(docname)
            except Exception:
                uri = None
            docs[docname] = {
                "source": source_of(docname),
                "title": text_of(env.titles.get(docname)),
                "uri": uri,
                "children": list(env.toctree_includes.get(docname, [])),
            }

        objects = []
        for name in sorted(app.registry.domains):
            domain = env.get_domain(name)
            for obj_name, dispname, objtype, docname, anchor, _prio in domain.get_objects():
                # Names can be lazy translation proxies; make them plain strings.
                obj_name, dispname = str(obj_name), str(dispname) if dispname else None
                objects.append(
                    {
                        "domain": name,
                        "type": str(objtype),
                        "name": obj_name,
                        "title": dispname if dispname and dispname != obj_name else None,
                        "doc": str(docname),
                        "anchor": str(anchor) if anchor else None,
                    }
                )

        result.update(
            ok=True,
            root_doc=getattr(app.config, "root_doc", None) or app.config.master_doc,
            docs=docs,
            objects=objects,
            read_docs=sorted(read_docs),
            written_docs=sorted(written_docs),
            consistency_checked=consistency["checked"],
        )
    except BaseException as e:  # conf.py and extensions can raise anything
        result["error"] = "".join(traceback.format_exception(type(e), e, e.__traceback__))

    srcdir = os.path.abspath(args.srcdir)
    for w in warnings.items:
        path = w.pop("path")
        # docutils sometimes reports "file.md:docstring of x"; keep the file part (with
        # its drive letter on Windows: C:\docs\index.md).
        file = re.match(r"(?:[A-Za-z]:)?[^:]*", path).group(0) if path else None
        if file and os.path.isabs(file):
            w["source"] = os.path.relpath(file, srcdir).replace(os.sep, "/")
        else:
            w["source"] = None
            if path:
                w["message"] = f"{path}: {w['message']}"
    result["warnings"] = warnings.items
    result["duration"] = round(time.time() - started, 3)

    data = json.dumps(result, default=str)
    with open(args.result, "w", encoding="utf-8") as f:
        f.write(data)
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
