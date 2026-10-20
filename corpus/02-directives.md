---
myst:
  html_meta:
    "description lang=en": "Configuring the widget"
---

(configuration)=
# Configuration

```{note}
Configuration is read from `widget.toml` in the project root.
```

:::{warning}
Changing these values on a running system requires a restart.
:::

```{admonition} Custom title
:class: tip

Admonitions can have a custom title and *rich* content.

- Including lists
- And more
```

::::{important}
Nested directives use more colons on the outside.

:::{code-block} toml
:linenos:
:emphasize-lines: 2

[widget]
colour = "red"
size = 12
:::
::::

```{figure} images/architecture.png
:alt: Architecture diagram
:width: 80%
:align: center

The widget architecture. Requests flow from left to right.
```

```{image} images/logo.svg
:alt: Logo
:height: 40px
```

```{math}
:label: energy

E = mc^2
```

Inline math works too: $a^2 + b^2 = c^2$, and so does {math}`\sqrt{2}`.

$$
\int_0^1 x\,dx = \frac{1}{2}
$$ (integral)

```{code-block} python
:caption: example.py
:linenos:

def hello(name: str) -> str:
    return f"Hello, {name}!"
```

```{list-table} Supported platforms
:header-rows: 1
:widths: 20 80

* - Platform
  - Notes
* - Linux
  - Fully supported
* - Windows
  - Experimental
```
