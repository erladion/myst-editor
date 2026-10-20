# User guide

```{toctree}
:maxdepth: 2
:caption: Contents

getting-started
configuration
api/index
```

(user-guide-refs)=
## Cross-references

See {ref}`configuration` for the settings, or {doc}`getting-started` for
installation. The {term}`widget` glossary entry explains the terminology.
Python objects can be referenced with {py:func}`widget.run` and
{py:class}`~widget.Widget`. Equation {eq}`energy` is famous.

You can also use Markdown-style links to targets: [configuration](#configuration)
and [the guide](getting-started.md).

Download the {download}`example file <files/example.zip>`.

## Glossary

```{glossary}
widget
  A small component that does one thing well.

gadget
  A larger component composed of widgets.
```

## Version notes

```{versionadded} 2.0
The `size` option.
```

```{deprecated} 3.1
Use `dimensions` instead.
```

## Raw reStructuredText

```{eval-rst}
.. autoclass:: widget.Widget
   :members:
   :undoc-members:
```

## Substitutions

This is version {{ version }} of the {{ project }} documentation.

## Only some builders

```{only} html
This paragraph only appears in HTML output.
```

```{seealso}
{ref}`configuration`
```

```{rubric} A rubric heading
```
