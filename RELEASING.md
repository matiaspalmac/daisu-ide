# Releasing Daisu

How to cut a tagged release with installer artifacts and a signed
auto-update manifest.

## Prerequisites — one-time setup

The Tauri updater verifies every download against a minisign signature.
If you lose the private key, every existing install can no longer
auto-update — they will have to download the next version manually.

```powershell
# Generate the keypair (already done — see ~/.tauri/daisu.key on the
# release machine). Re-run only if you are bootstrapping a fresh signer.
cargo tauri signer generate -w "$env:USERPROFILE\.tauri\daisu.key" -p ""
```

The public key already lives in `crates/daisu-app/tauri.conf.json` →
`plugins.updater.pubkey`. **Never commit the `.key` (private) file.**
Store the password (empty in our case) in a password manager.

## Cut a release

1. **Bump version everywhere** (these must stay in sync — Tauri reads
   `tauri.conf.json` while the auto-update manifest reads
   `Cargo.toml`):

   - `Cargo.toml` → `[workspace.package].version`
   - `package.json` → `"version"`
   - `apps/ui/package.json` → `"version"`
   - `crates/daisu-app/tauri.conf.json` → `"version"`

2. **Update CHANGELOG.md** — add a new entry below `[Unreleased]`
   summarising what shipped, then add the comparison link at the bottom.

3. **Commit + PR + merge** to `main`.

4. **Tag the merge commit on `main`:**
   ```powershell
   git checkout main
   git pull --ff-only
   git tag -a v0.X.Y-mZ <merge-sha> -m "MZ release"
   git push origin v0.X.Y-mZ
   ```

5. **Build signed installers locally** — the env var tells `tauri build`
   to sign each installer artifact and produce the matching `.sig`
   files that the updater consumes:
   ```powershell
   $env:TAURI_SIGNING_PRIVATE_KEY_PATH = "$env:USERPROFILE\.tauri\daisu.key"
   $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ""
   pnpm tauri build
   ```

   Output (under `target/release/`):
   - `bundle/nsis/Daisu_X.Y.Z_x64-setup.exe`
   - `bundle/nsis/Daisu_X.Y.Z_x64-setup.exe.sig`
   - `bundle/msi/Daisu_X.Y.Z_x64_en-US.msi`
   - `bundle/msi/Daisu_X.Y.Z_x64_en-US.msi.sig`
   - `daisu.exe` (portable; not auto-updatable)

6. **Generate `latest.json`** — the updater fetches this manifest from
   the GitHub release "latest" alias. The signature must be the **base64
   contents of the matching `.sig` file** (one line). Use the NSIS
   bundle as the canonical update payload (smaller + per-user install
   path = no admin prompt during silent update):
   ```powershell
   $version = "0.X.Y"  # without the "v" prefix
   $sig = (Get-Content "target/release/bundle/nsis/Daisu_${version}_x64-setup.exe.sig" -Raw).Trim()
   @{
     version    = $version
     notes      = "See https://github.com/matiaspalmac/daisu-ide/releases/tag/v${version}-m4 for the full notes."
     pub_date   = (Get-Date -Format "yyyy-MM-ddTHH:mm:ssZ").ToString()
     platforms  = @{
       "windows-x86_64" = @{
         signature = $sig
         url       = "https://github.com/matiaspalmac/daisu-ide/releases/download/v${version}-m4/Daisu_${version}_x64-setup.exe"
       }
     }
   } | ConvertTo-Json -Depth 4 | Set-Content latest.json
   ```

7. **Create the GitHub release + upload assets:**
   ```powershell
   gh release create v0.X.Y-mZ `
     --title "v0.X.Y-mZ — short title" `
     --notes-file release-notes.md
   gh release upload v0.X.Y-mZ `
     "target/release/bundle/nsis/Daisu_X.Y.Z_x64-setup.exe" `
     "target/release/bundle/nsis/Daisu_X.Y.Z_x64-setup.exe.sig" `
     "target/release/bundle/msi/Daisu_X.Y.Z_x64_en-US.msi" `
     "target/release/bundle/msi/Daisu_X.Y.Z_x64_en-US.msi.sig" `
     "target/release/daisu-X.Y.Z-mZ-portable-x64.zip" `
     "latest.json"
   ```

   The `latest.json` URL must resolve to the new release for the
   updater to find it — GitHub auto-aliases the most recent
   non-prerelease release as `/releases/latest/`.

8. **Smoke-test the auto-update path** before announcing:
   - Install the previous release on a fresh user
   - Launch it; within ~5 s a toast should appear offering the new
     version
   - Click install — it should download, install via NSIS in passive
     mode, and relaunch into the new build

## Notes

- The portable `daisu.exe` is not signed and not auto-updatable. It is
  shipped for sandboxed / quick-try testers.
- We use the per-user NSIS install with `installMode: "passive"` so the
  silent update during runtime does not pop UAC.
- If a release is marked `draft` or `prerelease` it will not show up at
  `/releases/latest/` — auto-update will not see it. Promote to
  "latest" in the GitHub UI when you are ready for testers to receive
  it.
- Want to defer code signing? See README. Until we sign, every download
  triggers a one-time SmartScreen warning. Auto-updates that follow are
  silent because they are launched from the trusted parent process.
