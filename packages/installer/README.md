# @sundegan/jsonstudio

Install the native JsonStudio desktop application on macOS, Windows x64, or Linux x64:

```sh
npx --yes @sundegan/jsonstudio install
```

Requires Node.js 20 or later. Native release downloads are verified against SHA256 checksums.

```sh
npx --yes @sundegan/jsonstudio install --version 1.5.0
npx --yes @sundegan/jsonstudio uninstall
```

Or install the launcher globally:

```sh
npm install -g @sundegan/jsonstudio
jsonstudio
```

The first launch installs the desktop app if needed. No npm lifecycle download scripts are used. Removing the global npm package removes the launcher only; uninstall the desktop app separately.

macOS supports Apple Silicon and Intel. Linux AppImage requires compatible glibc and FUSE. Installation does not bypass operating-system security confirmation.

## Options

```sh
npx --yes @sundegan/jsonstudio install --install-dir "/absolute/application/directory"
npx --yes @sundegan/jsonstudio install --bin-dir "/absolute/launcher/directory"
```

`--bin-dir` is available on macOS/Linux only. Reinstalling preserves the previous launcher directory when this option is omitted. Application version selection accepts stable versions (`x.y.z`). The installation reports its exact location and preserves user settings on uninstall.

Installers require `SHA256SUMS` in the selected GitHub Release. Maintainers can add it to an existing release using the **Publish installer checksums** workflow; future app releases generate it automatically. Installer updates require a new npm package version before publishing.
