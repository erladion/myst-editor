# Custom extensions

Projects often use directives from third-party or in-house extensions.

```{mermaid}
graph LR
  A[Client] --> B[Server]
  B --> C[(Database)]
```

::::{tab-set}

:::{tab-item} Linux
:sync: linux

Install with `apt install widget`.
:::

:::{tab-item} macOS
:sync: mac

Install with `brew install widget`.
:::

::::

```{dropdown} Click to expand
:open:
:color: info

Hidden content with **bold** text.
```

:::{company-callout}
:audience: internal
:owner: docs-team

This is a directive from an in-house Sphinx extension that the
editor knows nothing about.
:::

````{grid} 2
:gutter: 3

```{grid-item-card} Card one
Content one.
```

```{grid-item-card} Card two
Content two.
```
````

The API is {jira}`DOCS-123` tracked, and see {gh-issue}`42`.

<div class="custom-html">
  Raw HTML block
</div>

Inline <kbd>Ctrl</kbd>+<kbd>C</kbd> HTML.

% This is a MyST comment and must survive.

+++ {"some": "block-break-metadata"}

Text after a block break.
