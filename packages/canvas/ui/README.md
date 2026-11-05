# Shared UI

The look every canvas in this project shares: `theme.css` (colors, type, the page
header, buttons, menus, badges, labeled blocks, dialogs, and Markdown) and the
components in this folder. It is a plain folder, not a package: canvases import it
by path, and `canvas-kit new` uses it in every new canvas.

```tsx
// canvases/<name>/App.tsx
import { Header, Markdown, RefreshIcon } from '../../ui'
import '../../ui/theme.css'

<Header title="Release board" badge={<span className="pill status-working">Working</span>}>
  <button type="button" className="icon-button" aria-label="Refresh"><RefreshIcon /></button>
</Header>
<main className="page">
  <section className="block executive">
    <h2 className="label">Summary</h2>
    <Markdown>{state.summary}</Markdown>   {/* Markdown the agent writes, safely */}
  </section>
</main>
```

Colors come from the host's theme variables when it provides them, with GitHub-style
light and dark fallbacks. Use the classes in `theme.css` (`pill`, `badge`, `label`,
`block`, `bullets`, `rows`, `menu`, `dialog`, `banner`, `notice`) rather than new
styles, so canvases stay consistent.
