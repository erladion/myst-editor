import os
import sys

sys.path.insert(0, os.path.abspath("_ext"))

project = "Product docs"
extensions = ["myst_parser", "company_ext"]
myst_enable_extensions = ["colon_fence"]
