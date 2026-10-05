# Git client source

Imported at the user's request on 2026-10-05 from:

- https://xs927991.xsrv.jp/web-components/git-client.html
- https://xs927991.xsrv.jp/web-components/assets/css/parts-git-client.css
- https://xs927991.xsrv.jp/web-components/assets/js/parts-git-client.js

The CSS is the original component stylesheet. The JavaScript retains the source's list, parent-edge geometry, search, resize observation and keyboard navigation, adapted as an ES module accepting Rust version metadata. Circular button hit areas toggle accessible inline detail sections; simulated synchronization is replaced by actual local history reload. Instance teardown and explicit SVG height support host rerenders and generic icon styles.

App styles map the reference tokens and keep Compact dimensions: 3rem minimum row height, 5.75rem graph width, 1rem lane width. Explicit light colors and lane CSS classes provide compatibility with WebKit versions without `light-dark()` and the native `style-src` policy; dynamic HTML has no inline style attributes.

This component is a visualization. Local immutable version storage is implemented in Rust; it does not execute Git commands or connect to a remote repository. No license declaration was present in the fetched files; this note records provenance and does not assert a license for the source.
