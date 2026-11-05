# Paquete de Arch Linux

`PKGBUILD` compila Delta desde el tag `v$pkgver` del repo y lo empaqueta
como `delta-<versión>-1-x86_64.pkg.tar.zst`.

```bash
cd packaging/arch
makepkg -s            # compila e instala las dependencias que falten
sudo pacman -U delta-*.pkg.tar.zst
```

El paquete instala:

- `/usr/bin/delta`
- `/usr/share/applications/delta.desktop`
- `/usr/share/icons/hicolor/{32x32,128x128}/apps/delta.png`
- `/usr/share/licenses/delta/LICENSE`

La app se compila sin el bundle de Tauri: se construye el frontend con
`npm run build` y después el binario con `cargo build --release`, que
embebe `frontend/dist` en tiempo de compilación. No hace falta el CLI de
Tauri para este paquete.
