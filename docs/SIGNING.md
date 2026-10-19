# Code signing

SuperPhoto's installers are currently **unsigned**. That is the only reason
Windows shows *“Windows protected your PC”* (SmartScreen) and macOS refuses a
plain double-click until you use **right-click → Open**.

Signing removes both warnings. Nothing has to change in the code: the workflow
already contains every step. It stays dormant until the secrets below exist,
so an unsigned build is still produced (and still green) in the meantime.

| Platform | What is needed | Cost |
| --- | --- | --- |
| Windows | Azure Trusted Signing (Microsoft) | ~10 $/month |
| macOS | Apple Developer Program | 99 $/year |
| Linux | — (use `SHA256SUMS`) | free |

> Alternative for Windows: [SignPath.io](https://signpath.io) signs free for
> public open-source projects. The Azure steps below would be replaced by their
> GitHub Action; the rest of the pipeline is unchanged.

---

## Windows — Azure Trusted Signing

Since June 2023 a classic `.pfx` certificate in a GitHub secret is no longer
enough: the CA/Browser Forum requires the private key to live in certified
hardware. Azure Trusted Signing (formerly *Azure Code Signing*) is the cheapest
way to get a **short-lived, hardware-protected** certificate, and it signs from
CI with no USB token involved.

### 1. Create the Azure resources

1. In the [Azure portal](https://portal.azure.com), create a resource group.
2. Search for **Trusted Signing** → *Create*.
   - *Certificate profile type*: **Public Trust**
   - Note the **Endpoint** (e.g. `https://weu.codesigning.azure.net`),
     the **Account name** and the resource group.
3. Inside the account, create a **Certificate profile**:
   - Type **Public Trust**, *Profile name* e.g. `superphoto`
   - Complete the **identity validation** form (legal name, address, phone).
     Microsoft reviews it manually: allow **1–10 business days**. This is the
     step that proves you are the publisher shown in the SmartScreen dialog.

### 2. Let GitHub authenticate

1. *Microsoft Entra ID* → **App registrations** → **New registration**
   (`superphoto-ci`). Note the **Application (client) ID** and
   **Directory (tenant) ID**.
2. **Certificates & secrets** → **New client secret** → copy the value.
3. Back in the Trusted Signing account → **Access control (IAM)** →
   *Add role assignment* → role **Trusted Signing Certificate Profile Signer**
   → assign it to `superphoto-ci`.
4. Also grant `superphoto-ci` the **Reader** role on the Trusted Signing account
   itself (it needs to read the profile).

### 3. Fill in GitHub

**Settings → Secrets and variables → Actions → Secrets**

| Secret | Value |
| --- | --- |
| `AZURE_CLIENT_ID` | Application (client) ID |
| `AZURE_CLIENT_SECRET` | the client secret value |
| `AZURE_TENANT_ID` | Directory (tenant) ID |

**Settings → Secrets and variables → Actions → Variables** (not secrets)

| Variable | Example |
| --- | --- |
| `AZURE_TS_ENDPOINT` | `https://weu.codesigning.azure.net` |
| `AZURE_TS_ACCOUNT` | `superphoto-signing` |
| `AZURE_TS_PROFILE` | `superphoto` |

That is all. On the next build the *Activer la signature Windows* step installs
[`trusted-signing-cli`](https://github.com/Levminer/trusted-signing-cli), writes
a throw-away config fragment and passes it with `tauri build --config …`, so
`src-tauri/tauri.conf.json` is never modified. The *Vérifier la signature
Windows* step then fails the build if any installer is not `Valid`.

> The client secret expires. Put a reminder in your calendar one month before
> Azure marks it expired, or switch to
> [OIDC federated credentials](https://learn.microsoft.com/entra/workload-id/workload-identity-federation)
> to remove the secret entirely.

---

## macOS — Developer ID + notarisation

Tauri signs and notarises automatically as soon as six environment variables
exist, so the workflow only has to create them.

### 1. Get the certificate

1. Join the [Apple Developer Program](https://developer.apple.com/programs/)
   (99 $/year, the same account publishes to the App Store).
2. In *Certificates, Identifiers & Profiles* → **Certificates** → **+** →
   **Developer ID Application** → follow the CSR steps → download `cert.cer`
   and double-click it to add it to the login keychain.
3. In **Keychain Access**, find *Developer ID Application: Your Name (TEAMID)*,
   right-click → **Export** → format **.p12**, set a password.
4. Base64-encode it **on one line**:

   ```bash
   base64 -i cert.p12 | tr -d '\n' | pbcopy      # macOS, straight to clipboard
   ```

5. Create an **app-specific password** on
   [appleid.apple.com](https://appleid.apple.com) (used for notarisation), and
   note your **Team ID** (10 characters, top right of the developer portal).

### 2. Fill in GitHub

**Settings → Secrets and variables → Actions → Secrets**

| Secret | Value |
| --- | --- |
| `APPLE_CERTIFICATE` | the base64 `.p12` from step 4 |
| `APPLE_CERTIFICATE_PASSWORD` | the password chosen when exporting |
| `APPLE_SIGNING_IDENTITY` | `Developer ID Application: Your Name (TEAMID)` |
| `APPLE_ID` | your Apple ID e-mail |
| `APPLE_PASSWORD` | the app-specific password |
| `APPLE_TEAM_ID` | the 10-character Team ID |

The *Activer la signature macOS* step copies them under their real names only
when `APPLE_CERTIFICATE` is set. Without it, nothing is exported and the build
stays unsigned — exactly as today.

Notarisation adds a few minutes: Apple uploads the `.dmg`, scans it, and the
result is stapled to the disk image so it also validates offline.

---

## Checking a build

```powershell
# Windows — Status must be Valid; SignerCertificate shows the publisher
Get-AuthenticodeSignature .\SuperPhoto-Windows-x64-setup.exe | Format-List Status, SignerCertificate
```

```bash
# macOS — "accepted" and "source=Notarized Developer ID"
spctl -a -vvv -t exec /Applications/SuperPhoto.app
codesign --verify --deep --strict --verbose=2 /Applications/SuperPhoto.app
xcrun stapler validate /Applications/SuperPhoto.app
```

```bash
# Linux — the AppImage is not signed; integrity comes from the checksum
sha256sum -c SHA256SUMS --ignore-missing
```

---

## Why not sign on this machine?

Neither certificate can be moved to a laptop in a usable form: Windows requires
the key inside Microsoft's HSM, and an Apple Developer ID is bound to the
keychain it was created in. Signing therefore happens **only in CI**, which
already has the toolchain.

## Removing signing again

Delete the secrets (or the variables). The `if:` guards skip both activation
steps, `signCommand` is never written, and the next build is unsigned again.
