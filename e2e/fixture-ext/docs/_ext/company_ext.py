"""A small in-house extension, as a test stand-in for a company's own directives."""
from docutils import nodes
from docutils.parsers.rst import directives
from sphinx.util.docutils import SphinxDirective


class CompanyCallout(SphinxDirective):
    has_content = True
    option_spec = {"audience": directives.unchanged}

    def run(self):
        node = nodes.admonition(classes=["company-callout"])
        node += nodes.title(text=f"Internal note ({self.options.get('audience', 'internal')})")
        self.state.nested_parse(self.content, self.content_offset, node)
        return [node]


class ProductMatrix(SphinxDirective):
    """Generates content from its options alone: only Sphinx knows what it looks like."""

    option_spec = {"products": directives.unchanged}

    def run(self):
        products = [p.strip() for p in self.options.get("products", "").split(",") if p.strip()]
        listing = nodes.bullet_list()
        for product in products:
            listing += nodes.list_item("", nodes.paragraph(text=f"{product}: available"))
        return [nodes.container("", nodes.rubric(text="Product availability"), listing, classes=["product-matrix"])]


def jira_role(name, rawtext, text, lineno, inliner, options=None, content=None):
    url = f"https://jira.example.com/browse/{text}"
    return [nodes.reference(rawtext, text, refuri=url)], []


def setup(app):
    app.add_role("jira", jira_role)
    app.add_directive("company-callout", CompanyCallout)
    app.add_directive("product-matrix", ProductMatrix)
    return {"parallel_read_safe": True, "parallel_write_safe": True}
