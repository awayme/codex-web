# Codex Web installation

This guide covers the two supported container installations:

1. Docker on a local machine, with a persistent Docker volume.
2. A private, single-user Google Cloud Run service, with persistent state in
   Cloud Storage and secrets in Secret Manager.

It also explains remote-machine SSH configuration, OpenAI and CLI login,
updates, persistence, and known limitations.

## What the container includes

The production image contains:

- the patched Codex desktop browser client and the `codex-web` bridge;
- Node.js 22 and npm;
- the official Codex CLI;
- Google Cloud CLI (`gcloud`);
- GitHub CLI (`gh`);
- Git and Git LFS;
- Python 3, pip, virtual environments, and Python development headers;
- GCC, G++, `make`, and other native build tools;
- OpenSSH client;
- `curl`, `jq`, `ripgrep`, `fd`, `rsync`, SQLite, `zip`, `unzip`, `xz`,
  `nano`, `less`, `tree`, `file`, `lsof`, process tools, and network
  diagnostics; and
- Linux-native `node-pty` support for the in-app terminal.

The image runs as the non-root `codex` user. The exact pinned Codex, gcloud,
and GitHub CLI versions are defined in `Dockerfile`.

Installing an operating-system package interactively is not durable. Add a
required package to `Dockerfile`, rebuild the image, and deploy the new image.

## Prepare every remote machine

Codex Web reaches remote machines through SSH. Each remote machine needs:

- a reachable SSH server;
- key-based SSH authentication;
- the official installer-managed Codex CLI;
- its own Codex login and configuration; and
- `codex` available on the SSH login shell's `PATH`.

On each remote machine, run:

```bash
curl -fsSL https://chatgpt.com/codex/install.sh | sh
codex login
codex app-server daemon version
```

An npm-global Codex installation alone is not sufficient for the remote daemon
integration.

## Prepare SSH keys and host information

Create the local SSH source directory:

```bash
install -d -m 700 "$HOME/.config/codex-web/ssh"
touch "$HOME/.config/codex-web/ssh/config"
touch "$HOME/.config/codex-web/ssh/known_hosts"
chmod 600 \
  "$HOME/.config/codex-web/ssh/config" \
  "$HOME/.config/codex-web/ssh/known_hosts"
```

Copy the private key for a machine into that directory:

```bash
cp /path/to/id_ed25519_remote_server \
  "$HOME/.config/codex-web/ssh/remote_key"
chmod 600 "$HOME/.config/codex-web/ssh/remote_key"
```

Add the server's host key:

```bash
ssh-keyscan -H 80.190.72.35 \
  >> "$HOME/.config/codex-web/ssh/known_hosts"
```

Verify the scanned fingerprint through the server console or another trusted
channel before connecting.

Add a concrete alias to `~/.config/codex-web/ssh/config`:

```sshconfig
Host contabocodexcli
  HostName 80.190.72.35
  User root
  Port 22
  IdentityFile ~/.ssh/remote_key
  IdentitiesOnly yes
  StrictHostKeyChecking yes
  UserKnownHostsFile ~/.ssh/known_hosts
```

The `IdentityFile` and `UserKnownHostsFile` paths are paths inside the
container. At startup, the container copies `remote_key`, `known_hosts`, and
`config` from the read-only source into `/home/codex/.ssh`.

Test the same key and server before deploying:

```bash
ssh \
  -i "$HOME/.config/codex-web/ssh/remote_key" \
  -o IdentitiesOnly=yes \
  -o StrictHostKeyChecking=yes \
  -o UserKnownHostsFile="$HOME/.config/codex-web/ssh/known_hosts" \
  root@80.190.72.35 \
  'codex app-server daemon version'
```

### Add another machine

Repeat the key-copy and `ssh-keyscan` steps, then add another concrete alias:

```sshconfig
Host server-two
  HostName 203.0.113.20
  User root
  Port 22
  IdentityFile ~/.ssh/server_two_key
  IdentitiesOnly yes
  StrictHostKeyChecking yes
  UserKnownHostsFile ~/.ssh/known_hosts
```

Pattern-only entries such as `Host *` are not shown as selectable Codex
connections. Every machine needs a unique concrete alias.

After the container starts, open **Settings > Connections**, select **Add**,
and choose the alias. The app creates a separate Codex app-server connection
for every selected machine.

## Install locally with Docker

### Requirements

- Git
- Docker Desktop or Docker Engine with Buildx
- At least 6 GiB available to the Docker builder

Clone the fork:

```bash
git clone https://github.com/eladrave/codex-web.git
cd codex-web
```

Build the image:

```bash
docker build --tag codex-web:local .
```

Run it with a named persistent volume and the SSH source directory:

```bash
docker run --rm \
  --name codex-web \
  --publish 127.0.0.1:8080:8080 \
  --publish 127.0.0.1:1455:1455 \
  --volume codex-web-data:/data \
  --volume "$HOME/.config/codex-web/ssh:/run/secrets/codex-ssh:ro" \
  codex-web:local
```

Open <http://127.0.0.1:8080>.

Port `1455` is the local OpenAI OAuth callback bridge. Keep it bound to
`127.0.0.1`; do not expose it publicly.

On native Linux, the source SSH files must be readable by container UID
`10001`. The entrypoint copies readable source files into the container user's
private `.ssh` directory with mode `0600`.

### Local persistence

The named `codex-web-data` volume stores:

- OpenAI/Codex authentication;
- app preferences and custom instructions;
- memory state;
- connected-machine choices;
- GitHub CLI authentication and configuration;
- gcloud authentication and configuration; and
- global Git configuration.

Do not replace the named volume with an anonymous volume. Removing and
recreating the container is safe; deleting `codex-web-data` removes the local
persistent state.

### Local OpenAI, GitHub, and gcloud login

Complete OpenAI login in the web application. Then open the app terminal.

For GitHub:

```bash
gh auth login --web --git-protocol ssh
gh auth status
```

For Google Cloud:

```bash
gcloud auth login --no-launch-browser
gcloud config set project YOUR_PROJECT_ID
gcloud auth list
```

The container stores CLI configuration under:

```text
$CODEX_HOME/cli/gh
$CODEX_HOME/cli/gcloud
$CODEX_HOME/cli/gitconfig
```

With the named `/data` volume, these logins survive container recreation and
new image versions.

### Update the local installation

```bash
git pull --ff-only
docker build --tag codex-web:local .
docker stop codex-web
```

Start the container again with the same `docker run` command and the same
`codex-web-data` volume.

When SSH source files change, restart the container so the entrypoint copies
the updated files.

## Install on Google Cloud Run

The Cloud Run deployment is intended to be private and single-user. It uses:

- Google Cloud Build and Artifact Registry for the image;
- Secret Manager for OpenAI authentication and the SSH bundle;
- a private Cloud Storage bucket mounted at `/data`;
- rolling state snapshots in that bucket;
- a dedicated `codex-web-run` service account;
- Identity-Aware Proxy (IAP) for browser access; and
- exactly one always-allocated Cloud Run instance.

### Requirements

- a Google Cloud project with billing enabled;
- Google Cloud CLI installed and authenticated locally;
- Git and Docker;
- permission to manage Cloud Run, Cloud Build, Artifact Registry, IAM, IAP,
  Secret Manager, and Cloud Storage; and
- a locally built and OpenAI-authenticated `codex-web` container, used to seed
  the initial OpenAI secret.

Authenticate on the local machine:

```bash
gcloud auth login
gcloud auth list
gcloud projects list
gcloud config set project YOUR_PROJECT_ID
```

Build and start the local container first:

```bash
docker build --tag codex-web:local .

docker run --rm \
  --name codex-web \
  --publish 127.0.0.1:8080:8080 \
  --publish 127.0.0.1:1455:1455 \
  --volume codex-web-data:/data \
  --volume "$HOME/.config/codex-web/ssh:/run/secrets/codex-ssh:ro" \
  codex-web:local
```

Open <http://127.0.0.1:8080> and complete OpenAI login. Leave the container
running while starting the deployment, or keep the populated
`codex-web-data` volume.

### Deploy

From the repository root:

```bash
CODEX_WEB_GCLOUD_ACCOUNT=YOUR_GOOGLE_EMAIL \
./scripts/deploy-cloud-run.sh
```

For this installation:

```bash
CODEX_WEB_GCLOUD_ACCOUNT=eladrave@gmail.com \
./scripts/deploy-cloud-run.sh
```

The script asks which project to use. It then:

1. enables the required Google Cloud APIs;
2. creates or reuses Artifact Registry;
3. creates or reuses a private Cloud Storage bucket;
4. creates the restricted `codex-web-run` service account;
5. uploads OpenAI authentication and SSH files to Secret Manager;
6. builds a native `linux/amd64` image with Google Cloud Build;
7. deploys the image with the bucket mounted at `/data`;
8. limits Cloud Run to one always-allocated instance;
9. enables IAP; and
10. grants the active local Google account access through IAP.

The first deployment can take several minutes and incurs charges for the
always-allocated instance and related Google Cloud resources.

### Complete first-time IAP setup

If Google Cloud reports that IAP OAuth configuration is missing:

1. Open the service in **Google Cloud Console > Cloud Run**.
2. Open **Security**.
3. Select **Require authentication**.
4. Select **Identity-Aware Proxy (IAP)**.
5. Save and wait for the IAP configuration confirmation.
6. Rerun the deployment script.

Do not enable unauthenticated public access. This application can execute
commands locally and on configured remote machines.

### Cloud Run GitHub and gcloud login

IAP verifies the browser user but does not delegate that browser's Google OAuth
token into the container. Open the app terminal and authenticate the CLIs once.

For GitHub:

```bash
gh auth login --web --git-protocol ssh
gh auth status
```

For the same Google user permitted by IAP:

```bash
gcloud auth login YOUR_GOOGLE_EMAIL --no-launch-browser
gcloud config set project YOUR_PROJECT_ID
gcloud auth list --filter=status:ACTIVE --format='value(account)'
```

For this installation:

```bash
gcloud auth login eladrave@gmail.com --no-launch-browser
gcloud config set project aztm-amesh
```

Do not run `gcloud auth application-default login` in Cloud Run. The
application, Cloud Storage mount, and background state sync must continue using
the `codex-web-run` workload service account. Persisted user credentials are
only for interactive `gcloud` commands.

Wait at least 20 seconds after changing settings or credentials before
deliberately replacing the Cloud Run instance.

### Cloud Run persistence

Cloud Run's writable container filesystem is ephemeral. The application
therefore keeps active SQLite databases and Unix sockets on the instance-local
`/tmp` filesystem and creates an immutable state snapshot in Cloud Storage
every **15 seconds**.

The four newest valid snapshots are retained. A new instance restores the
newest valid snapshot before starting the application. A crash or immediate
replacement can lose changes made since the latest 15-second snapshot.

Snapshots preserve:

- application preferences;
- custom instructions and memory state;
- connected-machine choices;
- GitHub CLI credentials and settings;
- gcloud credentials and configurations; and
- global Git configuration.

OpenAI authentication and the SSH bundle are restored separately from Secret
Manager. Normal files under `/data` remain in the mounted Cloud Storage bucket.

The snapshot interval is 15 seconds, not 15 minutes.

### Add or change a remote machine on Cloud Run

1. Update `~/.config/codex-web/ssh/config`.
2. Copy the new private key into the same directory.
3. Add and verify the host key in `known_hosts`.
4. Test the SSH connection locally.
5. Rerun:

```bash
CODEX_WEB_GCLOUD_ACCOUNT=YOUR_GOOGLE_EMAIL \
./scripts/deploy-cloud-run.sh
```

The helper uploads a new Secret Manager version of the SSH bundle and deploys
a replacement revision. After it becomes healthy, open
**Settings > Connections** and add the new concrete alias.

### Update Cloud Run

For a manual update:

```bash
git pull --ff-only
CODEX_WEB_GCLOUD_ACCOUNT=YOUR_GOOGLE_EMAIL \
./scripts/deploy-cloud-run.sh
```

This fork also contains a GitHub Actions workflow that builds and deploys
merges to `main` when its Google Workload Identity and repository variables
have been configured. See `GoogleCloudRun.md` for the workflow variables,
rollback commands, and detailed troubleshooting.

## Known issues and limitations

### Settings are asynchronous

Cloud Run settings and CLI authentication are snapshotted every **15 seconds**.
Changes made immediately before a crash or revision replacement can be lost.
Wait at least 20 seconds after an important change before deliberately
restarting or deploying.

Local Docker with a named `/data` volume writes state directly to the volume
and does not use the Cloud Run snapshot bridge.

### The ChatGPT/Codex Browser feature does not work

The Browser feature exposed by the upstream ChatGPT/Codex desktop interface is
currently not functional in this Linux, browser-hosted container. This does not
refer to opening the Codex Web UI in Chrome, Safari, or another normal browser;
it refers to the in-app Browser tool.

### Authorize “Control other devices” on Cloud Run

OpenAI's native desktop OAuth client returns to
`http://localhost:1455/auth/callback` (or port `1457`). OpenAI rejects a Cloud
Run HTTPS URL for this registered client, so Codex Web provides a manual,
Cloud Run-only callback handoff:

1. Select **Settings > Connections > Control other devices > Set up >
   Authorize on chatgpt.com**.
2. Complete the OpenAI authentication in the new tab.
3. When the browser reaches the unavailable localhost callback page, copy the
   complete URL from that tab's address bar.
4. Return to Codex Web, paste the URL into **Complete remote-control
   authorization**, and select **Complete authorization**.

Do not paste the callback URL into chat, issue trackers, or logs. It contains a
short-lived authorization code. Codex Web sends the pasted URL over the
existing authenticated WebSocket to the Cloud Run instance that is waiting for
it. The instance validates the localhost host, callback port, path, OAuth
state, and PKCE exchange before completing enrollment. The code does not enter
Cloud Run HTTP request logs.

For an automatic handoff instead, you may run the included optional one-time
relay on the same computer and in the same browser where you use Codex Web:

```bash
cd /path/to/codex-web
npm run cloud-run:oauth-relay -- \
  https://YOUR-EXACT-CODEX-WEB-SERVICE-URL
```

Use the exact origin shown in the browser address bar. Keep the command
running during authorization, then stop the relay with `Ctrl-C`.

If the browser blocks the automatic OpenAI tab, Codex Web displays a
**Continue authorization** prompt. Select **Continue on auth.openai.com**;
that direct click is permitted by browser popup rules.

The optional relay only listens on loopback ports `1455` and `1457`. It redirects
the OAuth result back to the existing Cloud Run HTTPS origin in the URL
fragment, which keeps the authorization code out of Cloud Run request logs.
The open Codex Web tab then delivers the callback over its existing WebSocket
to the correct container instance. No additional Cloud Run port is exposed.

On Linux, Codex Web uses a P-256 software device key because OpenAI's bundled
desktop implementation otherwise requires the macOS Keychain and Secure
Enclave. The private key is stored with owner-only permissions inside
`CODEX_HOME`, so it survives local `/data` volume reuse and Cloud Run state
snapshots. Cloud Run protects this key through the service's private access
controls and the storage bucket's encryption and IAM; it is not a
hardware-backed, non-extractable key. Wait at least 20 seconds after the first
successful authorization before deliberately restarting or redeploying.

If an optional relay port is already occupied, the relay prints a warning.
Close the process using that port and rerun the command, or use the manual
callback handoff.

### IAP login is not gcloud login

IAP controls access to the web application and supplies the authenticated
email identity to the service. It does not provide reusable Google API
credentials to terminal processes. `gcloud auth login` must be completed
separately once.

### Cloud Storage is not a POSIX filesystem

Do not point `CODEX_HOME` or `CODEX_WEB_DATA_DIR` directly at the Cloud Storage
FUSE mount. SQLite databases and Unix sockets require the local filesystem.
Use the included snapshot mechanism.

### Interactive package installation is not durable

The container runs as non-root, and its root filesystem is replaced with every
new instance or image. Permanent utilities must be added to `Dockerfile`.

### Cloud Run uses dynamic outbound addresses by default

If a remote SSH firewall requires a fixed source IP, configure Direct VPC
egress and Cloud NAT with a reserved static outbound IP.

## Security notes

- Never commit private SSH keys, `auth.json`, GitHub tokens, gcloud credential
  databases, generated secret archives, or populated CLI configuration.
- Keep local ports `8080` and `1455` bound to `127.0.0.1`.
- Keep Cloud Run private behind IAP.
- Grant IAP access only to intended users.
- Verify SSH host fingerprints before adding them to `known_hosts`.
- Prefer a non-root SSH user when possible.
- Anyone with access to the Cloud Storage state bucket can potentially use
  persisted CLI credentials.

## Additional documentation

- `README.md` describes the project and container architecture.
- `GoogleCloudRun.md` contains deeper Cloud Run operations, automation,
  rollback, and troubleshooting details.
- `AGENTS.md` records repository maintenance and validation requirements.
