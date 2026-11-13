# src/styles/heroui-tokens.css

Copied from `web/theme/tokens/heroui-tokens.css` (single source of truth for the MLBox colours,
radius and motion), exactly as `web/dashboard/src/styles/` does, because Turbopack refuses to import
CSS from outside the package tree.

`npm test` fails when this copy drifts from the source. Sync with:

```bash
cp web/theme/tokens/heroui-tokens.css web/admin/ui/src/styles/heroui-tokens.css
```

Never add a colour here or in `globals.css`; add the token to the source file first.
