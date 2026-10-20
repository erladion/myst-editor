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

        def doctree_resolved(_app, _doctree, docname):
            warnings.phase = "write"  # for Sphinx < 7.3, which lacks write-started
            written_docs.add(docname)

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
        if path and os.path.isabs(path.split(":")[0]):
            # docutils sometimes reports "file.md:docstring of x"; keep the file part.
            path = path.split(":")[0]
            w["source"] = os.path.relpath(path, srcdir).replace(os.sep, "/")
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
