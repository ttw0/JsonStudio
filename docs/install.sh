#!/bin/sh
# JsonStudio installer. No Node.js, jq, sudo, or build tools are required.
set -eu

fail() { printf 'Error: %s\n' "$*" >&2; exit 1; }
say() { printf '%s\n' "$*"; }
quote() { printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")"; }
valid_path() {
  case "$1" in /*) ;; *) fail "Installation paths must be absolute: $1" ;; esac
  if printf '%s' "$1" | LC_ALL=C grep -q '[[:cntrl:]]'; then
    fail "Installation paths must not contain control characters."
  fi
}
canonical_dir() { (CDPATH= cd "$1" && pwd -P); }
managed_launcher() {
  [ ! -L "$1" ] && [ -f "$1" ] && grep -q '^# Managed by JsonStudio installer$' "$1"
}
validate_existing_app() {
  [ ! -L "$1" ] || fail "Refusing to manage a symbolic-link application at $1."
  [ -e "$1" ] || return 0
  case "$os" in
    Darwin)
      [ -d "$1" ] || fail "Expected an application bundle at $1."
      [ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$1/Contents/Info.plist")" = com.jsonstudio.app ] ||
        fail "The installed app has an unexpected identity." ;;
    Linux)
      [ -f "$1" ] || fail "Expected a regular AppImage file at $1; nothing was removed." ;;
  esac
}
download() {
  curl --fail --silent --show-error --location --retry 3 --connect-timeout 15 \
    --max-time 600 --proto '=https' --proto-redir '=https' "$1" -o "$2"
}
hash_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  else
    fail "Install sha256sum or shasum before running this installer."
  fi
}

version=${JSONSTUDIO_VERSION:-latest}
install_dir=${JSONSTUDIO_INSTALL_DIR:-}
bin_dir=${JSONSTUDIO_BIN_DIR:-}
action=${JSONSTUDIO_ACTION:-install}
while [ "$#" -gt 0 ]; do
  case "$1" in
    --version|--install-dir|--bin-dir)
      [ "$#" -ge 2 ] || fail "Missing value for $1"
      case "$1" in
        --version) version=$2 ;;
        --install-dir) install_dir=$2 ;;
        --bin-dir) bin_dir=$2 ;;
      esac
      shift 2 ;;
    --uninstall) action=uninstall; shift ;;
    --help)
      say 'Usage: sh install.sh [--version 1.5.0] [--install-dir PATH] [--bin-dir PATH] [--uninstall]'
      exit 0 ;;
    *) fail "Unknown option: $1" ;;
  esac
done
[ "$action" = install ] || [ "$action" = uninstall ] || fail "Unknown action: $action"
custom_install_dir=$install_dir
state_dir=${XDG_DATA_HOME:-"$HOME/.local/share"}/jsonstudio-installer
valid_path "$state_dir"
if [ -n "$bin_dir" ]; then valid_path "$bin_dir"; fi
os=$(uname -s)
case "$os" in
  Darwin) suffix=macos; extension=app.tar.gz ;;
  Linux) suffix=linux; extension=AppImage ;;
  *) fail "Unsupported system: $os. Windows users should use install.ps1." ;;
esac
if command -v pgrep >/dev/null 2>&1; then
  for process_name in jsonstudio 'Json Studio' 'Json.Studio'; do
    if pgrep -x "$process_name" >/dev/null 2>&1; then
      fail "Close JsonStudio before installing or uninstalling."
    fi
  done
fi
mkdir -p "$state_dir"
lock_dir=$state_dir/.lock
mkdir "$lock_dir" 2>/dev/null ||
  fail "Another installer may be running. If none is running, remove the stale lock directory: $lock_dir"
trap 'rmdir "$lock_dir" 2>/dev/null || true' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

if [ "$action" = uninstall ]; then
  [ -f "$state_dir/app-path" ] || fail "No script-managed installation was found."
  app_path=$(cat "$state_dir/app-path")
  valid_path "$app_path"
  case "$os:$app_path" in
    Darwin:*/Json\ Studio.app) ;;
    Linux:*/JsonStudio.AppImage) ;;
    *) fail "Invalid installation record; nothing was removed." ;;
  esac
  validate_existing_app "$app_path"
  if [ -f "$state_dir/bin-path" ]; then
    launcher=$(cat "$state_dir/bin-path")
    valid_path "$launcher"
    if managed_launcher "$launcher"; then
      rm -f "$launcher"
    fi
  fi
  if [ "$os" = Linux ]; then
    desktop_file=${XDG_DATA_HOME:-"$HOME/.local/share"}/applications/com.jsonstudio.app.desktop
    if [ -f "$desktop_file" ] && grep -q '^X-JsonStudio-Installer=true$' "$desktop_file"; then
      rm -f "$desktop_file"
    fi
  fi
  if [ "$os" = Darwin ]; then rm -rf "$app_path"
  else rm -f "$app_path"; fi
  rm -f "$state_dir/app-path" "$state_dir/bin-path" "$state_dir/version"
  say 'JsonStudio was uninstalled. Your documents and application settings were kept.'
  exit 0
fi

if [ "$version" != latest ]; then
  version=${version#v}
  printf '%s\n' "$version" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$' || fail "Invalid version: $version"
fi
arch=$(uname -m)
if [ "$os" = Darwin ] && [ "$arch" = x86_64 ] &&
  [ "$(sysctl -n sysctl.proc_translated 2>/dev/null || true)" = 1 ]; then
  arch=arm64
fi
case "$os:$arch" in
  Darwin:arm64|Darwin:aarch64) arch=aarch64 ;;
  Darwin:x86_64) arch=x64 ;;
  Linux:x86_64|Linux:amd64) arch=amd64 ;;
  *) fail "No release is available for $os/$arch. Linux ARM64 is not supported yet." ;;
esac

if [ -f "$state_dir/app-path" ]; then
  previous_app=$(cat "$state_dir/app-path")
  valid_path "$previous_app"
  if [ -z "$install_dir" ]; then install_dir=$(dirname "$previous_app"); fi
fi
previous_launcher=
if [ -f "$state_dir/bin-path" ]; then
  previous_launcher=$(cat "$state_dir/bin-path")
  valid_path "$previous_launcher"
  [ "$(basename "$previous_launcher")" = jsonstudio ] || fail "Invalid launcher installation record."
  if [ -z "$bin_dir" ] && managed_launcher "$previous_launcher"; then
    bin_dir=$(dirname "$previous_launcher")
  fi
fi
bin_dir=${bin_dir:-"$HOME/.local/bin"}
if [ -z "$install_dir" ]; then
  if [ "$os" = Darwin ]; then install_dir=$HOME/Applications
  else install_dir=${XDG_DATA_HOME:-"$HOME/.local/share"}/jsonstudio; fi
fi
valid_path "$install_dir"
valid_path "$bin_dir"
mkdir -p "$install_dir" "$bin_dir"
install_dir=$(canonical_dir "$install_dir")
bin_dir=$(canonical_dir "$bin_dir")
if [ -n "${previous_app:-}" ] && [ -d "$(dirname "$previous_app")" ]; then
  previous_app=$(canonical_dir "$(dirname "$previous_app")")/$(basename "$previous_app")
fi
if [ -n "$previous_launcher" ] && [ -d "$(dirname "$previous_launcher")" ]; then
  previous_launcher=$(canonical_dir "$(dirname "$previous_launcher")")/jsonstudio
fi
if [ "$os" = Darwin ]; then app_path=$install_dir/Json\ Studio.app
else app_path=$install_dir/JsonStudio.AppImage; fi
launcher=$bin_dir/jsonstudio
if [ -n "${previous_app:-}" ] && [ "$previous_app" != "$app_path" ]; then
  fail "Already installed at $previous_app. Uninstall it before changing the location."
fi
if [ "$os" = Darwin ] && [ -z "$custom_install_dir" ] && [ "$app_path" != '/Applications/Json Studio.app' ] &&
  [ -e '/Applications/Json Studio.app' ]; then
  fail "An existing app is in /Applications. Update it through its original installation channel."
fi
validate_existing_app "$app_path"
if [ -e "$app_path" ] && [ "${previous_app:-}" != "$app_path" ]; then
  fail "Refusing to replace an unmanaged app at $app_path."
fi
if [ -e "$launcher" ] || [ -L "$launcher" ]; then
  managed_launcher "$launcher" ||
    fail "Refusing to replace an existing command at $launcher. Use --bin-dir to choose another directory."
fi
command -v curl >/dev/null 2>&1 || fail "curl is required."
desktop_dir=${XDG_DATA_HOME:-"$HOME/.local/share"}/applications
desktop_file=$desktop_dir/com.jsonstudio.app.desktop
if [ "$os" = Linux ] && { [ -e "$desktop_file" ] || [ -L "$desktop_file" ]; }; then
  [ -f "$desktop_file" ] && [ ! -L "$desktop_file" ] &&
    grep -q '^X-JsonStudio-Installer=true$' "$desktop_file" ||
    fail "Refusing to replace an unmanaged applications-menu entry at $desktop_file."
fi

stage_dir=
backup=
switched=0
committed=0
previous_launcher_removed=0
backup_file() {
  if [ -e "$1" ]; then
    [ -f "$1" ] && [ ! -L "$1" ] || fail "Expected a regular managed file at $1."
    cp -p "$1" "$stage_dir/$2.previous"
  fi
}
restore_file() {
  if [ -f "$stage_dir/$2.previous" ]; then mv -f "$stage_dir/$2.previous" "$1"
  else rm -f "$1"; fi
}
cleanup() {
  exit_status=$?
  set +e
  recovery_failed=0
  if [ "$committed" -eq 0 ]; then
    if [ "$switched" -eq 1 ]; then
      if rm -rf "$app_path"; then
        if [ -n "$backup" ] && [ -e "$backup" ]; then
          mv "$backup" "$app_path" || recovery_failed=1
        fi
      else recovery_failed=1; fi
      restore_file "$launcher" launcher || recovery_failed=1
      restore_file "$state_dir/app-path" app-path || recovery_failed=1
      restore_file "$state_dir/bin-path" bin-path || recovery_failed=1
      restore_file "$state_dir/version" version || recovery_failed=1
      if [ "$os" = Linux ]; then restore_file "$desktop_file" desktop || recovery_failed=1; fi
      if [ "$previous_launcher_removed" -eq 1 ]; then
        restore_file "$previous_launcher" previous-launcher || recovery_failed=1
      fi
    elif [ -n "$backup" ] && [ -e "$backup" ]; then
      mv "$backup" "$app_path" || recovery_failed=1
    fi
  fi
  if [ "$recovery_failed" -eq 1 ]; then
    printf 'Recovery files retained at %s. Some installation files could not be restored.\n' "$stage_dir" >&2
  elif [ -n "$stage_dir" ]; then rm -rf "$stage_dir"; fi
  rmdir "$lock_dir" 2>/dev/null || true
  return "$exit_status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
if [ "$os" = Linux ]; then mkdir -p "$desktop_dir"; fi
stage_dir=$(mktemp -d "$install_dir/.jsonstudio-install.XXXXXX")
base=https://github.com/sundegan/JsonStudio/releases
if [ "$version" = latest ]; then release_url=$base/latest/download
else release_url=$base/download/v$version; fi
say "Resolving JsonStudio for $os/$arch..."
if ! download "$release_url/SHA256SUMS" "$stage_dir/SHA256SUMS"; then
  fail "Release checksums are unavailable. The publisher must run the Publish installer checksums workflow for this release."
fi
# SHA256SUMS is a standard, line-oriented manifest; never evaluate its content.
selected=$(awk -v suffix="_${suffix}_${arch}.${extension}" '
  NF == 2 && length($1) == 64 && $1 !~ /[^0-9a-f]/ &&
  $2 ~ /^Json[.]Studio_[0-9]+[.][0-9]+[.][0-9]+_/ &&
  substr($2, length($2) - length(suffix) + 1) == suffix { print $1, $2 }
' "$stage_dir/SHA256SUMS")
[ "$(printf '%s\n' "$selected" | awk 'NF {count++} END {print count+0}')" -eq 1 ] ||
  fail "The release must contain exactly one checksum for $os/$arch."
expected=$(printf '%s\n' "$selected" | awk '{print $1}')
asset=$(printf '%s\n' "$selected" | awk '{print $2}')
resolved=${asset#Json.Studio_}
resolved=${resolved%%_*}
[ "$asset" = "Json.Studio_${resolved}_${suffix}_${arch}.${extension}" ] ||
  fail "Invalid asset name in the checksum manifest."
[ "$version" = latest ] || [ "$version" = "$resolved" ] || fail "Release version mismatch."
version=$resolved
say "Downloading JsonStudio $version..."
download "$base/download/v$version/$asset" "$stage_dir/$asset"
[ "$(hash_file "$stage_dir/$asset")" = "$expected" ] || fail "SHA256 verification failed. Nothing was installed."

if [ "$os" = Darwin ]; then
  tar -tzf "$stage_dir/$asset" > "$stage_dir/members"
  awk '
    $0 !~ /^Json Studio[.]app(\/|$)/ || $0 ~ /(^|\/)[.][.](\/|$)/ { bad=1 }
    END {exit bad}
  ' "$stage_dir/members" || fail "Unexpected paths in the application archive."
  tar -xzf "$stage_dir/$asset" -C "$stage_dir"
  staged_app=$stage_dir/Json\ Studio.app
  [ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$staged_app/Contents/Info.plist")" = com.jsonstudio.app ] ||
    fail "The downloaded app has an unexpected identity."
  codesign --verify --deep --strict "$staged_app"
else
  staged_app=$stage_dir/$asset
  chmod 755 "$staged_app"
  desktop_exec=$(printf '%s' "$app_path" | sed 's/\\/\\\\/g; s/"/\\"/g; s/\$/\\$/g; s/`/\\`/g; s/%/%%/g')
  printf '[Desktop Entry]\nType=Application\nName=JsonStudio\nExec="%s" %%F\nIcon=applications-development\nTerminal=false\nCategories=Development;Utility;\nMimeType=application/json;application/x-ndjson;\nX-JsonStudio-Installer=true\n' \
    "$desktop_exec" > "$stage_dir/desktop"
fi
{
  printf '#!/bin/sh\n# Managed by JsonStudio installer\n'
  if [ "$os" = Darwin ]; then printf 'exec /usr/bin/open -a %s --args "$@"\n' "$(quote "$app_path")"
  else printf 'exec %s "$@"\n' "$(quote "$app_path")"; fi
} > "$stage_dir/launcher"
chmod 755 "$stage_dir/launcher"
printf '%s\n' "$app_path" > "$stage_dir/app-path"
printf '%s\n' "$launcher" > "$stage_dir/bin-path"
printf '%s\n' "$version" > "$stage_dir/version"
backup_file "$launcher" launcher
backup_file "$state_dir/app-path" app-path
backup_file "$state_dir/bin-path" bin-path
backup_file "$state_dir/version" version
if [ "$os" = Linux ]; then backup_file "$desktop_file" desktop; fi
if [ -n "$previous_launcher" ] && [ "$previous_launcher" != "$launcher" ] && managed_launcher "$previous_launcher"; then
  backup_file "$previous_launcher" previous-launcher
fi

if [ -e "$app_path" ]; then
  backup=$stage_dir/previous-app
  mv "$app_path" "$backup"
fi
switched=1
mv "$staged_app" "$app_path"
mv "$stage_dir/launcher" "$launcher"
mv "$stage_dir/app-path" "$state_dir/app-path"
mv "$stage_dir/bin-path" "$state_dir/bin-path"
mv "$stage_dir/version" "$state_dir/version"
if [ "$os" = Linux ]; then
  mv "$stage_dir/desktop" "$desktop_file"
  if command -v update-desktop-database >/dev/null 2>&1; then
    update-desktop-database "$desktop_dir" >/dev/null 2>&1 || true
  fi
fi
if [ -f "$stage_dir/previous-launcher.previous" ] && managed_launcher "$previous_launcher"; then
  previous_launcher_removed=1
  rm -f "$previous_launcher"
fi
committed=1
say "Installed JsonStudio $version at $app_path"
say "Launch it from your applications menu, or run: $(quote "$launcher")"
case ":$PATH:" in *":$bin_dir:"*) ;; *) say "To use the short command, add $bin_dir to your PATH." ;; esac
if [ "$os" = Darwin ]; then
  say 'These builds are not Developer ID notarized. macOS may require confirmation in Privacy & Security.'
else
  say 'AppImage requires a compatible glibc and FUSE runtime. If FUSE is unavailable, use --appimage-extract-and-run.'
fi
