# Widget documentation

Welcome to the **Widget** docs. Widgets are small components that do one
thing well. Read {doc}`guide/install` to get started, or jump to
{ref}`configuration`.

```{toctree}
:maxdepth: 2
:caption: Contents

guide/install
guide/configure
```

:::{note}
Widgets require Python 3.10 or newer.
:::

:::{figure} images/diagram.svg
:alt: How requests flow through a widget
:width: 60%

Requests flow from the client to the widget.
:::

The energy of a widget is $E = mc^2$, and in general:

$$
\int_0^1 x\,dx = \frac{1}{2}
$$ (integral)

## Quick example

```python
import widget
widget.run()
```

1. Install the package.
2. Create a `widget.toml`.
3. Run `widget`.

| Option   | Default |
|----------|---------|
| `colour` | `blue`  |

:::{company-callout}
:audience: internal

Ask the platform team before deploying widgets to production.
:::
