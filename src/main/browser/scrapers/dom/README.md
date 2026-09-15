# Page-side extractors

Every function in this directory is handed to Playwright's `page.evaluate`, which
serializes it with `Function#toString` and runs it inside the page. Two rules follow:

- **Self-contained.** No imports, no module-level helpers, no closures over anything
  outside the function body. Type annotations are fine (they are erased); a shared
  helper is not (it would be an undefined identifier in the page).
- **`root` is optional.** The functions take a `Document` so the tests can hand them a
  jsdom one, and fall back to the page's global `document` when Playwright calls them
  with no argument.

Keeping them here rather than inline in each scraper is what makes the selectors
testable against saved fixture markup without launching a browser.
