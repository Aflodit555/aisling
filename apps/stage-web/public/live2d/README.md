# Local Live2D assets

Place the files here without renaming paths referenced by `model3.json`:

```text
public/live2d/
├── live2dcubismcore.min.js       # From the official Cubism SDK for Web
└── aisling/
    ├── aisling.model3.json
    ├── *.moc3
    ├── textures/
    └── optional motions, physics, expressions, and pose files
```

Use `VITE_CUBISM_CORE_URL` and `VITE_LIVE2D_MODEL_URL` to point at different
same-origin paths.
